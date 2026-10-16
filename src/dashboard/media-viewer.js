import { node } from '../lib/dom.js';
import { mb } from '../lib/format.js';

// Full-screen viewer for an inspection's media: photos (zoomable) and the
// preview video (plays in the browser). A filmstrip and the arrow keys move
// between items.
const KIND_LABEL = { photo: 'Photo', preview: 'Preview video' };
export const thumbUrl = asset => `/api/assets/${asset.id}/thumbnail.jpg`;
const fileUrl = asset => `/api/assets/${asset.id}`;

function ensureStyle() {
  if (document.getElementById('media-viewer-style')) return;
  const style = document.createElement('style');
  style.id = 'media-viewer-style';
  style.textContent = `
  #media-viewer{width:min(1280px,96vw);max-width:96vw;max-height:94vh;padding:0;border:0;border-radius:14px;background:#0f1720;color:#e6edf3;overflow:hidden}
  #media-viewer::backdrop{background:#0b1218d9}
  #media-viewer .mv-head{display:flex;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid #1f2b36}
  #media-viewer .mv-title{flex:1;min-width:0}
  #media-viewer .mv-title h3{margin:0;font-size:15px;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #media-viewer .mv-title small{color:#93a4b4;font-size:12px}
  #media-viewer .mv-count{color:#93a4b4;font-size:12px;white-space:nowrap}
  #media-viewer button{background:#1c2833;border:1px solid #2c3b48;color:#e6edf3}
  #media-viewer button:hover{background:#263544}
  #media-viewer .mv-close{font-size:20px;padding:2px 11px;line-height:1.3}
  #media-viewer .mv-stage{position:relative;display:grid;place-items:center;height:min(66vh,620px);background:#000;overflow:hidden}
  #media-viewer .mv-stage img,#media-viewer .mv-stage video{max-width:100%;max-height:100%;display:block}
  #media-viewer .mv-photo{cursor:zoom-in;transition:transform .2s ease}
  #media-viewer .mv-photo.zoomed{cursor:zoom-out;transform:scale(2.4)}
  #media-viewer .mv-nav{position:absolute;top:50%;transform:translateY(-50%);width:44px;height:64px;padding:0;font-size:26px;border-radius:10px;opacity:.85;z-index:2}
  #media-viewer .mv-prev{left:12px}#media-viewer .mv-next{right:12px}
  #media-viewer .mv-nav:disabled{opacity:.25}
  #media-viewer .mv-strip{display:flex;gap:8px;padding:10px 12px;overflow-x:auto;border-top:1px solid #1f2b36;background:#0f1720}
  #media-viewer .mv-thumb{position:relative;flex:0 0 120px;height:60px;padding:0;border-radius:7px;overflow:hidden;border:2px solid transparent;background:#1c2833}
  #media-viewer .mv-thumb[aria-current=true]{border-color:#4ea1ff}
  #media-viewer .mv-thumb img{width:100%;height:100%;object-fit:cover;display:block}
  #media-viewer .mv-thumb span{position:absolute;left:4px;bottom:3px;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;background:#000a;color:#fff}
  #media-viewer .mv-fallback{display:grid;place-items:center;width:100%;height:100%;font-size:11px;color:#93a4b4}
  #media-viewer .mv-foot{display:flex;justify-content:space-between;gap:10px;padding:0 16px 12px;font-size:12px;color:#93a4b4}
  #media-viewer .mv-foot a{color:#8cc4ff}`;
  document.head.append(style);
}

function image(src, alt, className) {
  const img = node('img', undefined, className);
  img.src = src;
  img.alt = alt;
  img.addEventListener('error', () => img.replaceWith(node('span', 'Preview not available', 'mv-fallback')));
  return img;
}

function badge(kind) {
  return { photo: 'PHOTO', preview: '▶ PREVIEW' }[kind];
}

export function openViewer(items, start = 0) {
  if (!items.length) return;
  ensureStyle();
  let dialog = document.getElementById('media-viewer');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'media-viewer';
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => dialog.querySelector('video')?.pause());
    document.body.append(dialog);
  }
  let index = Math.min(Math.max(start, 0), items.length - 1);

  const title = node('h3'), meta = node('small'), count = node('span', '', 'mv-count');
  const heading = node('div', undefined, 'mv-title');
  heading.append(title, meta);
  const close = node('button', '×', 'mv-close');
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => dialog.close());
  const head = node('div', undefined, 'mv-head');
  head.append(heading, count, close);

  const stage = node('div', undefined, 'mv-stage');
  const prev = node('button', '‹', 'mv-nav mv-prev'), next = node('button', '›', 'mv-nav mv-next');
  prev.setAttribute('aria-label', 'Previous');
  next.setAttribute('aria-label', 'Next');
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));

  const strip = node('div', undefined, 'mv-strip');
  const thumbs = items.map((item, i) => {
    const b = node('button', undefined, 'mv-thumb');
    b.type = 'button';
    b.title = item.name;
    b.append(image(thumbUrl(item.asset), item.name), node('span', badge(item.kind)));
    b.addEventListener('click', () => show(i));
    strip.append(b);
    return b;
  });
  const foot = node('div', undefined, 'mv-foot');

  function show(i) {
    if (i < 0 || i >= items.length) return;
    index = i;
    const item = items[i];
    stage.querySelector('video')?.pause();
    title.textContent = item.name;
    meta.textContent = [KIND_LABEL[item.kind], item.size ? mb(item.size) : ''].filter(Boolean).join(' · ');
    count.textContent = `${i + 1} / ${items.length}`;
    let content;
    if (item.kind === 'photo') {
      content = image(thumbUrl(item.asset), item.name, 'mv-photo');
      content.addEventListener('click', e => {
        const r = content.getBoundingClientRect();
        content.style.transformOrigin = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
        content.classList.toggle('zoomed');
      });
    } else {
      content = node('video');
      content.controls = true;
      content.autoplay = true;
      content.src = fileUrl(item.asset);
    }
    stage.replaceChildren(prev, content, next);
    prev.disabled = i === 0;
    next.disabled = i === items.length - 1;
    thumbs.forEach((b, n) => b.setAttribute('aria-current', String(n === i)));
    thumbs[i].scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const original = node('a', 'Download original ↗');
    original.href = fileUrl(item.asset);
    original.target = '_blank';
    original.rel = 'noopener';
    foot.replaceChildren(node('span', item.kind === 'photo' ? 'Shown at reduced size · click to zoom' : ' '), original);
  }

  dialog.onkeydown = e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
  };
  dialog.replaceChildren(head, stage, strip, foot);
  if (!dialog.open) dialog.showModal();
  show(index);
}
