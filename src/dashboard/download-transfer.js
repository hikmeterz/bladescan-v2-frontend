// Camera download: row button, progress dialog and timeline step.
// Downloads copy the original recordings from the camera SD card to the Jetson.
// request() and the signed-in user come from the dashboard modules through ctx.
import { closeOnBackdrop } from '../lib/dom.js';
import { mb, duration } from '../lib/format.js';


const path = id => '/api/inspections/' + encodeURIComponent(id) + '/downloads';
const active = d => ['queued', 'downloading'].includes(d?.state);
const closed = new Set(['succeeded', 'aborted', 'canceled']);


// File sizes are only known once a file starts downloading, so the overall
// percent is file-based: finished files plus the fraction of the active one.
export function downloadPercent(d) {
  if (!d || d.state === 'not_downloaded') return 0;
  if (d.state === 'ready') return 100;
  const files = Array.isArray(d.files) ? d.files : [];
  const total = d.total_files || files.length;
  if (!total) return 0;
  const done = Number.isSafeInteger(d.completed_files) ? d.completed_files : files.filter(f => f.state === 'ready').length;
  const current = files.find(f => f.state === 'downloading');
  const ratio = current && current.total_bytes > 0 ? Math.min(1, current.downloaded_bytes / current.total_bytes) : 0;
  return Math.min(99, Math.floor(100 * (done + ratio) / total));
}

function activeFile(d) {
  return (Array.isArray(d?.files) ? d.files : []).find(f => f.state === 'downloading') || null;
}

function rowLabel(d) {
  const total = d?.total_files || 0, done = d?.completed_files || 0;
  switch (d?.state) {
    case 'downloading': {
      const f = activeFile(d);
      if (f && f.total_bytes > 0 && f.downloaded_bytes >= f.total_bytes) return `Verifying · ${Math.min(total, done + 1)}/${total}`;
      return `Downloading ${downloadPercent(d)}%` + (total ? ` · ${Math.min(total, done + 1)}/${total}` : '');
    }
    case 'queued': return total ? `Queued · ${done}/${total}` : 'Queued';
    case 'ready': return 'Downloaded';
    case 'failed': return 'Retry download';
    case 'unknown': return 'Download: check';
    default: return 'Download';
  }
}

// "Video Downloaded" step in the inspection timeline.
export function downloadTimelineStep(d) {
  const s = d?.state || 'not_downloaded';
  const total = d?.total_files || 0, done = d?.completed_files || 0;
  const count = total ? ` · ${done}/${total} files` : '';
  if (s === 'ready')
    return { title: 'Video Downloaded', status: 'done', detail: `Original recordings stored on Jetson${count}` };
  if (s === 'downloading')
    return { title: 'Video Downloaded', status: 'active', detail: `Downloading to Jetson · ${downloadPercent(d)}%${count}` };
  if (s === 'queued')
    return { title: 'Video Downloaded', status: 'active', detail: `Waiting in download queue${count}` };
  if (s === 'failed')
    return { title: 'Video Downloaded', status: 'warning', detail: `Download failed${count}` };
  if (s === 'unknown')
    return { title: 'Video Downloaded', status: 'warning', detail: 'Transfer outcome unknown; retry required' };
  return { title: 'Video Downloaded', status: 'pending', detail: 'Not downloaded to Jetson yet.' };
}

function ensureStyle() {
  if (document.getElementById('download-transfer-style')) return;
  const style = document.createElement('style');
  style.id = 'download-transfer-style';
  style.textContent = `
  .inspection-download-button{white-space:nowrap;font-variant-numeric:tabular-nums}
  .inspection-download-button[data-state="downloading"],.inspection-download-button[data-state="queued"]{color:#1d4ed8;border-color:#93c5fd}
  .inspection-download-button[data-state="ready"]{color:#15803d;border-color:#86efac}
  .inspection-download-button[data-state="failed"],.inspection-download-button[data-state="unknown"]{color:#b91c1c;border-color:#fca5a5}
  #download-dialog{width:min(36rem,calc(100vw - 2rem))}
  #download-dialog .dl-location{margin:.25rem 0 1rem;color:#475569}
  #download-dialog .dl-meter{display:flex;align-items:baseline;gap:.75rem;margin-bottom:.4rem}
  #download-dialog .dl-percent{font-size:2.25rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;min-width:4.5ch}
  #download-dialog .dl-figures{color:#475569;font-size:.85rem;font-variant-numeric:tabular-nums}
  #download-dialog .dl-bar{height:.6rem;border-radius:999px;background:#e2e8f0;overflow:hidden}
  #download-dialog .dl-bar span{display:block;height:100%;width:0;background:#2563eb;transition:width .4s ease}
  #download-dialog[data-state="ready"] .dl-bar span{background:#16a34a}
  #download-dialog[data-state="failed"] .dl-bar span,#download-dialog[data-state="unknown"] .dl-bar span{background:#dc2626}
  #download-dialog .dl-files{list-style:none;margin:1rem 0 0;padding:0;max-height:14rem;overflow:auto;border-top:1px solid #e2e8f0}
  #download-dialog .dl-files li{display:grid;grid-template-columns:1fr auto;gap:.15rem 1rem;padding:.5rem 0;border-bottom:1px solid #e2e8f0;font-size:.85rem}
  #download-dialog .dl-files .dl-name{font-weight:600;overflow-wrap:anywhere}
  #download-dialog .dl-files .dl-state{text-align:right;font-variant-numeric:tabular-nums;color:#475569}
  #download-dialog .dl-files li[data-state="downloading"] .dl-state{color:#1d4ed8;font-weight:600}
  #download-dialog .dl-files li[data-state="ready"] .dl-state{color:#15803d}
  #download-dialog .dl-files li[data-state="failed"] .dl-state,#download-dialog .dl-files li[data-state="unknown"] .dl-state{color:#b91c1c}
  #download-dialog .dl-files small{grid-column:1/-1;color:#64748b}
  #download-dialog .dl-message{margin:.9rem 0 0;min-height:1.4em}
  #download-dialog[data-state="ready"] .dl-message{color:#166534;font-weight:600}
  #download-dialog[data-state="failed"] .dl-message,#download-dialog[data-state="unknown"] .dl-message{color:#b91c1c}
  #download-dialog .dl-hint{margin:.4rem 0 0;color:#64748b;font-size:.85rem}
  #download-dialog .dl-hint:empty{display:none}
  @media (prefers-reduced-motion:reduce){#download-dialog .dl-bar span{transition:none}}`;
  document.head.append(style);
}

// ---------- progress dialog ----------

let dialog = null, timer = null, generation = 0;

function buildDialog() {
  dialog = document.createElement('dialog');
  dialog.id = 'download-dialog';
  dialog.setAttribute('aria-labelledby', 'download-title');
  dialog.innerHTML = `
    <div class="dialog-heading">
      <div><p class="eyebrow">CAMERA DOWNLOAD</p><h2 id="download-title">Download recordings to Jetson</h2></div>
      <button type="button" class="dl-close" aria-label="Close">×</button>
    </div>
    <p class="dl-location"></p>
    <div class="dl-meter"><span class="dl-percent">0%</span><span class="dl-figures"></span></div>
    <div class="dl-bar" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100"><span></span></div>
    <ul class="dl-files" aria-label="Files"></ul>
    <p class="dl-message" role="status"></p>
    <p class="dl-hint"></p>
    <div class="dialog-actions">
      <button type="button" class="dl-dismiss">Close</button>
      <button type="button" class="primary dl-start">Start download</button>
    </div>`;
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.querySelector('.dl-close').addEventListener('click', close);
  dialog.querySelector('.dl-dismiss').addEventListener('click', close);
  dialog.addEventListener('close', () => { generation++; clearTimeout(timer); });
  closeOnBackdrop(dialog, close);
}

function fileState(f) {
  if (f.state === 'downloading') {
    if (f.total_bytes > 0 && f.downloaded_bytes >= f.total_bytes) return 'Verifying…';
    return f.total_bytes > 0 ? `${Math.floor(100 * f.downloaded_bytes / f.total_bytes)}%` : 'Starting…';
  }
  return { queued: 'Waiting', ready: 'Done', failed: 'Failed', unknown: 'Unknown' }[f.state] || f.state;
}

export function openDownloadDialog(inspection, ctx, { initial, canStart, onUpdate }) {
  ensureStyle();
  if (!dialog) buildDialog();
  clearTimeout(timer);
  const gen = ++generation;
  let state = initial || { state: 'not_downloaded' }, busy = false, error = '';

  const q = s => dialog.querySelector(s);
  q('.dl-location').textContent =
    `${inspection.plant} / ${inspection.turbine} · Blade ${inspection.blade} / Section ${inspection.section}`;

  const startButton = q('.dl-start');
  const replaced = startButton.cloneNode(true); // drop the listener of the previous inspection
  startButton.replaceWith(replaced);
  replaced.addEventListener('click', start);

  function render() {
    const s = state.state;
    dialog.dataset.state = s;
    const pct = downloadPercent(state);
    q('.dl-percent').textContent = s === 'not_downloaded' ? '—' : `${pct}%`;
    q('.dl-bar span').style.width = `${pct}%`;
    q('.dl-bar').setAttribute('aria-valuenow', String(pct));

    const files = Array.isArray(state.files) ? state.files : [];
    const current = activeFile(state);
    let figures = state.total_files ? `${state.completed_files || 0} of ${state.total_files} files` : '';
    if (current && current.total_bytes > 0) {
      figures += ` · ${mb(current.downloaded_bytes)} / ${mb(current.total_bytes)}`;
      if (current.speed_mb_s > 0) {
        figures += ` · ${current.speed_mb_s.toFixed(1)} MB/s`;
        const left = duration((current.total_bytes - current.downloaded_bytes) / (current.speed_mb_s * 1e6));
        if (left && current.downloaded_bytes < current.total_bytes) figures += ` · ~${left} left for this file`;
      }
    }
    q('.dl-figures').textContent = figures;

    q('.dl-files').replaceChildren(...files.map(f => {
      const li = document.createElement('li');
      li.dataset.state = f.state;
      const name = document.createElement('span');
      name.className = 'dl-name';
      name.textContent = f.name;
      const st = document.createElement('span');
      st.className = 'dl-state';
      st.textContent = fileState(f) + (f.total_bytes > 0 ? ` · ${mb(f.total_bytes)}` : '');
      li.append(name, st);
      if (f.message && f.state !== 'ready') {
        const note = document.createElement('small');
        note.textContent = f.message;
        li.append(note);
      }
      return li;
    }));

    const allowed = canStart();
    let message = '', hint = '';
    if (s === 'not_downloaded') {
      message = 'The original videos and photos will be copied from the camera SD card to the Jetson.';
      hint = allowed ? 'The camera must be connected. File sizes appear as each file starts.'
        : 'Finish the inspection first.';
    } else if (s === 'queued') {
      message = 'Waiting in the download queue.';
      hint = 'Another inspection may be downloading. This one starts automatically.';
    } else if (s === 'downloading') {
      message = current && current.total_bytes > 0 && current.downloaded_bytes >= current.total_bytes
        ? `Saving and checking ${current.name}…`
        : `Downloading ${current?.name || 'files'}…`;
      hint = 'You can close this window; the download continues in the background.';
    } else if (s === 'ready') {
      message = 'All recordings are stored on the Jetson.';
      hint = 'You can now export them to USB.';
    } else if (s === 'failed') {
      message = 'Download failed.';
      hint = 'Check that the camera is connected, then retry. Files already downloaded are kept.';
    } else if (s === 'unknown') {
      message = 'The outcome of a previous transfer is unknown; the download queue is paused.';
      hint = 'Check the camera driver, then retry to continue.';
    }
    if (state.queue_paused && s !== 'unknown') hint = 'The download queue is paused because another transfer has an unknown outcome.';
    q('.dl-message').textContent = error || message;
    q('.dl-hint').textContent = hint;

    const button = q('.dl-start');
    button.hidden = active(state) || s === 'ready';
    button.textContent = ['failed', 'unknown'].includes(s) ? 'Retry download' : 'Start download';
    button.disabled = busy || !allowed;
    q('.dl-dismiss').textContent = active(state) ? 'Continue in background' : 'Close';
  }

  async function start() {
    if (busy) return;
    busy = true; error = ''; render();
    try {
      state = (await ctx.request(path(inspection.request_id), {})).download;
      onUpdate(state);
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      if (gen === generation && dialog.open) { render(); schedule(); }
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (gen === generation && dialog.open && active(state)) timer = setTimeout(poll, 1000);
  }

  async function poll() {
    try {
      const next = (await ctx.request(path(inspection.request_id))).download;
      if (gen !== generation || !dialog.open) return;
      const changed = next.state !== state.state || next.completed_files !== state.completed_files;
      state = next; error = '';
      render();
      if (changed || !active(state)) onUpdate(state);
    } catch (e) {
      if (gen === generation && dialog.open) q('.dl-hint').textContent = 'Could not get status: ' + e.message;
    }
    schedule();
  }

  render();
  if (!dialog.open) dialog.showModal();
  // Fetch the full file list right away; list rows carry only a summary.
  (async () => {
    try {
      const next = (await ctx.request(path(inspection.request_id))).download;
      if (gen === generation && dialog.open) { state = next; render(); onUpdate(state); }
    } catch {}
    schedule();
  })();
}

// ---------- row button ----------

// Status label: Completed -> Downloading/Queued -> Video Downloaded.
// Once the row is exported to USB, the USB module owns the label.
function applyPill(row, inspection, d) {
  if (!row || inspection.state !== 'succeeded' || row.dataset.usbState === 'ready') return;
  const pill = row.querySelector('td:nth-child(4) .pill');
  if (!pill) return;
  const [text, tone] = d?.state === 'ready' ? ['Video Downloaded', 'succeeded']
    : d?.state === 'downloading' ? ['Downloading', 'running']
    : d?.state === 'queued' ? ['Queued', 'submitted']
    : ['Completed', 'succeeded'];
  if (pill.textContent !== text) { pill.textContent = text; pill.dataset.state = tone; }
}

export function mountDownloadRow(cell, inspection, ctx) {
  ensureStyle();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspection-download-button';
  button.setAttribute('aria-haspopup', 'dialog');
  cell.append(button);

  let state = inspection.download || { state: 'not_downloaded' }, timer = null;
  const canStart = () => ctx.getMe()?.role !== 'viewer' && closed.has(inspection.state);

  function render() {
    const s = state.state;
    button.textContent = rowLabel(state);
    button.dataset.state = s;
    button.disabled = s === 'not_downloaded' && !canStart();
    button.title = s === 'ready' ? 'Original recordings are stored on the Jetson.'
      : s === 'not_downloaded' && !canStart() ? 'Finish the inspection before downloading.'
      : state.queue_paused ? 'The download queue is paused: another transfer has an unknown outcome.'
      : 'Download details';
    button.setAttribute('aria-label', `Section ${inspection.section}: ${button.textContent}`);
    applyPill(button.closest('tr'), inspection, state);
  }

  function schedule() {
    clearTimeout(timer);
    if (button.isConnected && active(state)) timer = setTimeout(poll, state.state === 'downloading' ? 1000 : 3000);
  }
  async function poll() {
    if (!button.isConnected) return;
    const hidden = button.closest('.inspection-group-content')?.hidden;
    if (!hidden && !document.hidden) {
      try { state = (await ctx.request(path(inspection.request_id))).download; render(); }
      catch (e) { button.title = e.message; }
    }
    schedule();
  }

  button.addEventListener('click', () => openDownloadDialog(inspection, ctx, {
    initial: state, canStart,
    onUpdate: next => { state = next; render(); schedule(); },
  }));

  render();
  // The caller appends the row to the table after this function returns.
  queueMicrotask(() => {
    const row = button.closest('tr');
    const tracking = row?.querySelector('.tracking-button');
    if (tracking) new MutationObserver(() => applyPill(row, inspection, state))
      .observe(tracking, { childList: true, subtree: true, characterData: true });
    render();
    schedule();
  });
}
