import { sectionLabel } from '../lib/format.js';
import { $, node } from '../lib/dom.js';
import { date, mb } from '../lib/format.js';
import { send as request } from '../lib/api.js';
import { pill } from './status.js';
import { openViewer, thumbUrl } from './media-viewer.js';
import { confirmDelete } from './confirm-delete.js';
import { recoveryBlocks } from './recovery.js';

// "Details" dialog: inspection facts, then its media as cards (videos, photos,
// preview). Every camera file listed by the recording is shown, also those
// still on the camera, with where it is now (camera, download queue, Jetson).
// Clicking a card that is on the Jetson opens the media viewer.
const fileName = p => String(p || '').split('/').pop();
const isPhoto = name => /\.(insp|jpe?g|dng)$/i.test(name);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ensureStyle() {
  if (document.getElementById('details-media-style')) return;
  const style = document.createElement('style');
  style.id = 'details-media-style';
  style.textContent = `
  #detail-dialog{width:min(1040px,95vw)}
  .media-summary{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center;margin:0 0 4px;font-size:13px;color:#41546b}
  .media-summary strong{color:#24364b}
  .media-section{margin-top:18px}
  .media-section h3{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 8px;font-size:14px}
  .media-section h3 small{font-weight:400;color:#697c88;font-size:12px}
  .media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
  .media-card{border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;background:#f8fafc;font-size:12px}
  .media-card > button{position:relative;display:block;width:100%;padding:0;border:0;border-radius:0;background:#1f2a35;aspect-ratio:2/1;cursor:pointer}
  .media-card > button:disabled{cursor:default;background:#e9eef3;opacity:1}
  .media-card > button img{display:block;width:100%;height:100%;object-fit:cover}
  .media-card > button:not(:disabled):hover img{opacity:.85}
  .media-card .media-badge{position:absolute;left:8px;top:8px;font-size:10px;font-weight:700;padding:2px 6px;border-radius:5px;background:#000b;color:#fff}
  .media-card .media-play{position:absolute;inset:0;display:grid;place-items:center;font-size:30px;color:#fff;text-shadow:0 2px 8px #000a;pointer-events:none}
  .media-card .media-placeholder{display:grid;place-items:center;height:100%;color:#7b8794;padding:8px;text-align:center;font-weight:600}
  .media-card footer{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;align-items:center;padding:8px 10px}
  .media-card footer strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;color:#24364b}
  .media-card footer small{color:#697c88}
  .media-card footer a{justify-self:end;font-size:12px}
  .media-state{font-size:10px;font-weight:700;padding:3px 7px;border-radius:5px;background:#eef2f5;color:#617282;white-space:nowrap}
  .media-state[data-state=jetson]{background:#e8f5ec;color:#267244}
  .media-state[data-state=active]{background:#e7f2fc;color:#2a6798}
  .media-state[data-state=error]{background:#fff0e4;color:#a56422}
  .delete-zone{margin-top:22px;padding-top:14px;border-top:1px solid #edf0f4;display:flex;justify-content:flex-end}`;
  document.head.append(style);
}

function stateOf(name, asset, downloads) {
  if (asset) return { key: 'jetson', label: 'On Jetson' };
  const f = downloads.get(name);
  if (f?.state === 'downloading') {
    const pct = f.total_bytes ? Math.floor((f.downloaded_bytes / f.total_bytes) * 100) : 0;
    return { key: 'active', label: `Downloading ${pct}%` };
  }
  if (f?.state === 'queued') return { key: 'active', label: 'Queued' };
  if (f?.state === 'verifying') return { key: 'active', label: 'Verifying' };
  if (f?.state === 'failed') return { key: 'error', label: 'Download failed' };
  if (f?.state === 'unknown') return { key: 'error', label: 'Check download' };
  return { key: 'camera', label: 'On camera' };
}

// Expected camera files (from the recording's file list) merged with what is
// on the Jetson. Older inspections without a file list show their assets only.
function collectMedia(d) {
  const assets = d.assets || [];
  const byName = new Map(assets.filter(a => a.relative_path).map(a => [fileName(a.relative_path), a]));
  const downloads = new Map((d.download?.files || []).map(f => [fileName(f.name), f]));
  const listed = [...(d.native?.origin_files || []), ...(d.native?.photo_files || [])].map(fileName);
  const names = listed.length ? [...new Set(listed)]
    : assets.filter(a => a.kind === 'native_insv' || a.kind === 'native_photo').map(a => fileName(a.relative_path) || a.id);
  const files = names.map(name => {
    const asset = byName.get(name) || assets.find(a => a.id === name);
    const f = downloads.get(name);
    return { name, asset, kind: isPhoto(name) || asset?.kind === 'native_photo' ? 'photo' : 'insv',
      size: asset?.size_bytes || f?.total_bytes || 0, state: stateOf(name, asset, downloads) };
  });
  const previews = assets.filter(a => a.kind === 'preview').map(a => ({
    name: fileName(a.relative_path) || 'preview.mp4', asset: a, kind: 'preview', size: a.size_bytes,
    state: { key: 'jetson', label: 'On Jetson' } }));
  const videos = files.filter(f => f.kind === 'insv'), photos = files.filter(f => f.kind === 'photo');
  // The viewer shows photos and the preview. Original .insv videos (8K, both lenses)
  // are listed with a download link only: they play in Insta360 Studio.
  const viewable = [...photos, ...previews].filter(f => f.asset);
  return { files, videos, photos, previews, viewable, downloading: files.some(f => f.state.key === 'active') };
}

function summary(media, usb) {
  const onJetson = media.files.filter(f => f.state.key === 'jetson').length;
  const total = media.files.reduce((sum, f) => sum + f.size, 0);
  const box = node('p', undefined, 'media-summary');
  box.append(node('strong', `${plural(media.videos.length, 'video')} · ${plural(media.photos.length, 'photo')}`));
  if (total) box.append(node('span', mb(total)));
  if (media.files.length) {
    box.append(node('span', onJetson === media.files.length ? 'All on Jetson' : `${onJetson} of ${media.files.length} on Jetson`));
  }
  if (usb?.state === 'ready') box.append(node('span', 'Exported to USB ✓'));
  return box;
}

function card(item, media) {
  const el = node('article', undefined, 'media-card');
  const open = node('button');
  open.type = 'button';
  if (item.asset && item.kind !== 'insv') {
    const img = node('img');
    img.loading = 'lazy';
    img.alt = '';
    img.src = thumbUrl(item.asset);
    img.addEventListener('error', () => img.replaceWith(node('span', item.kind === 'photo' ? 'Photo' : 'Video', 'media-placeholder')));
    open.append(img, node('span', { photo: 'PHOTO', insv: '360° INSV', preview: 'PREVIEW MP4' }[item.kind], 'media-badge'));
    if (item.kind === 'preview') open.append(node('span', '▶', 'media-play'));
    open.setAttribute('aria-label', 'Open ' + item.name);
    open.addEventListener('click', () => openViewer(media.viewable, media.viewable.indexOf(item)));
  } else {
    open.disabled = true;
    open.append(node('span', item.kind === 'insv' && item.asset ? '360° video · Insta360 Studio' : item.state.label, 'media-placeholder'));
  }
  const footer = node('footer');
  const state = node('span', item.state.label, 'media-state');
  state.dataset.state = item.state.key;
  footer.append(node('strong', item.name), state, node('small', item.size ? mb(item.size) : 'Size not known yet'));
  if (item.kind === 'insv' && item.asset) {
    const download = node('a', 'Download ↗');
    download.href = '/api/assets/' + item.asset.id;
    footer.append(download);
  }
  footer.firstChild.title = item.name;
  el.append(open, footer);
  return el;
}

function section(heading, note, items, media, empty) {
  const box = node('section', undefined, 'media-section');
  const title = node('h3', heading);
  title.append(node('small', note));
  box.append(title);
  if (!items.length) { box.append(node('p', empty, 'muted')); return box; }
  const grid = node('div', undefined, 'media-grid');
  for (const item of items) grid.append(card(item, media));
  box.append(grid);
  return box;
}

// Permanent deletion of the inspection (database records and Jetson folder).
function deleteSection(r, media, usb, dialog) {
  const box = node('section', undefined, 'media-section delete-zone');
  const button = node('button', 'Delete inspection…', 'danger-outline');
  button.type = 'button';
  button.addEventListener('click', async () => {
    const onJetson = [...media.files.filter(f => f.asset), ...media.previews];
    const bytes = onJetson.reduce((sum, f) => sum + (f.size || 0), 0);
    const ok = await confirmDelete({
      title: 'Delete this inspection?',
      items: [`${r.plant} / ${r.turbine} / Blade ${r.blade} / ${sectionLabel(r.section)}`],
      details: `Its folder on the Jetson (${plural(onJetson.length, 'media file')}${bytes ? ', ' + mb(bytes) : ''}, plus recording data) `
        + 'and its history are removed permanently. Files on the camera SD card and on USB drives are not affected.',
      warning: usb?.state === 'ready' ? '' : 'This inspection has not been exported to USB: the files on the Jetson are the only downloaded copy.',
      run: () => request(`/api/inspections/${r.request_id}/delete`, { confirm: r.request_id }),
    });
    if (ok) { dialog.close(); document.dispatchEvent(new CustomEvent('inspections-changed')); }
  });
  box.append(button);
  return box;
}

let refreshTimer = null;

export function openDetails(id) {
  ensureStyle();
  clearTimeout(refreshTimer);
  $('detail-title').textContent = 'Loading…';
  $('detail-body').replaceChildren();
  const dialog = $('detail-dialog');
  if (!dialog.open) dialog.showModal();
  return load(id, dialog);
}

async function load(id, dialog) {
  try {
    const d = await request('/api/inspections/' + id);
    if (!dialog.open) return;
    const r = d.inspection;
    $('detail-title').textContent = r.plant + ' / ' + r.turbine;
    $('detail-title').append(pill(r.state));

    const grid = node('div', undefined, 'detail-grid');
    for (const [key, value] of [['Operator', r.operator_name_snapshot], ['Blade / Section', r.blade + ' / ' + sectionLabel(r.section)],
      ['Started', date(r.created_at)], ['Finished', date(r.finished_at)]]) {
      const p = node('p');
      p.append(node('small', key), document.createTextNode(value));
      grid.append(p);
    }
    const media = collectMedia(d);
    const top = dialog.scrollTop;
    const body = [grid, summary(media, d.usb_upload),
      section('Photos', 'Both lenses in one image · click to view', media.photos, media, 'No photos were taken.'),
      section('Videos', 'Original 360° recordings (.insv) · play in Insta360 Studio', media.videos, media, 'No videos.')];
    body.splice(1, 0, ...recoveryBlocks(d, () => load(id, dialog)));
    if (media.previews.length) {
      body.push(section('Preview', 'Low-resolution copy of the live view · plays in the browser', media.previews, media, ''));
    }
    if (document.body.dataset.role !== 'viewer') body.push(deleteSection(r, media, d.usb_upload, dialog));
    $('detail-body').replaceChildren(...body);
    dialog.scrollTop = top;
    // While files are coming down, refresh their states every few seconds.
    if (media.downloading) refreshTimer = setTimeout(() => { if (dialog.open) load(id, dialog); }, 3000);
  } catch (e) {
    $('detail-title').textContent = 'Could not load details';
    $('detail-body').textContent = e.message;
  }
}
