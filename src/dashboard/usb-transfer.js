import { sectionLabel } from '../lib/format.js';
// USB export: row button, progress dialog and timeline step.
// request() and the signed-in user come from the dashboard modules through ctx.
import { closeOnBackdrop } from '../lib/dom.js';
import { mb, duration } from '../lib/format.js';


const STEPS = [
  { title: 'Check drive', stages: ['', 'starting', 'detecting', 'mounting', 'checking_space'] },
  { title: 'Write', stages: ['writing', 'syncing'] },
  { title: 'Verify', stages: ['verifying'] },
  { title: 'Eject', stages: ['finalizing', 'unmounting', 'done'] },
];
const STAGE_TEXT = {
  '': 'Waiting in queue…', starting: 'Preparing…', detecting: 'Looking for a USB drive…',
  mounting: 'Mounting the drive…', checking_space: 'Checking free space…',
  writing: 'Writing the ZIP to the drive…', syncing: 'Flushing the last data to the drive…',
  verifying: 'Checking the CRC of every file on the drive…', finalizing: 'Finalizing the file name…',
  unmounting: 'Ejecting the drive safely…', done: 'Done',
};
const STAGE_SHORT = {
  '': 'queued', starting: 'preparing', detecting: 'finding drive', mounting: 'mounting',
  checking_space: 'checking space', writing: 'writing', syncing: 'flushing', verifying: 'verifying',
  finalizing: 'finalizing', unmounting: 'ejecting', done: 'done',
};

const path = id => '/api/inspections/' + encodeURIComponent(id) + '/usb-upload';
const active = s => ['queued', 'running'].includes(s?.state);

function stepIndex(stage) {
  const i = STEPS.findIndex(s => s.stages.includes(stage || ''));
  return i < 0 ? 0 : i;
}

// Overall percent weighted by stage: check 2, write 2-82, verify 84-98, finish 98-100.
export function overallPercent(u) {
  if (!u || u.state === 'not_started') return 0;
  if (u.state === 'ready') return 100;
  const ratio = u.bytes_total > 0 ? Math.min(1, u.bytes_done / u.bytes_total) : 0;
  switch (u.stage) {
    case 'writing': return Math.floor(2 + 80 * ratio);
    case 'syncing': return 83;
    case 'verifying': return Math.floor(84 + 14 * ratio);
    case 'finalizing': case 'unmounting': case 'done': return 99;
    default: return u.state === 'running' ? 1 : 0;
  }
}


// "Data Transferred" step in the inspection timeline.
export function usbTimelineStep(u) {
  const s = u?.state || 'not_started';
  const time = u?.updated_at || null;
  if (s === 'ready')
    return { title: 'Data Transferred', status: 'done', detail: `Exported to USB and verified · ${u.zip_name}`, time };
  if (s === 'queued')
    return { title: 'Data Transferred', status: 'active', detail: 'Waiting in USB transfer queue.', time: null };
  if (s === 'running')
    return { title: 'Data Transferred', status: 'active',
      detail: `USB transfer ${overallPercent(u)}% · ${STAGE_SHORT[u.stage] || u.stage}`, time: null };
  if (s === 'failed')
    return { title: 'Data Transferred', status: 'warning', detail: 'USB transfer failed · ' + (u.message || ''), time };
  return { title: 'Data Transferred', status: 'pending', detail: 'Not transferred to USB yet.', time: null };
}

function ensureStyle() {
  if (document.getElementById('usb-transfer-style')) return;
  const style = document.createElement('style');
  style.id = 'usb-transfer-style';
  style.textContent = `
  .inspection-usb-button{margin-left:.4rem;white-space:nowrap;font-variant-numeric:tabular-nums}
  .inspection-usb-button[data-state="running"],.inspection-usb-button[data-state="queued"]{color:#1d4ed8;border-color:#93c5fd}
  .inspection-usb-button[data-state="ready"]{color:#15803d;border-color:#86efac}
  .inspection-usb-button[data-state="failed"]{color:#b91c1c;border-color:#fca5a5}
  #usb-dialog{width:min(34rem,calc(100vw - 2rem))}
  #usb-dialog .usb-location{margin:.25rem 0 1rem;color:#475569}
  #usb-dialog .usb-steps{list-style:none;margin:0 0 1.25rem;padding:0;display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem}
  #usb-dialog .usb-steps li{border-top:3px solid #e2e8f0;padding-top:.45rem;font-size:.8rem;color:#64748b}
  #usb-dialog .usb-steps li[data-state="done"]{border-color:#16a34a;color:#166534}
  #usb-dialog .usb-steps li[data-state="active"]{border-color:#2563eb;color:#1e3a8a;font-weight:600}
  #usb-dialog .usb-steps li[data-state="error"]{border-color:#dc2626;color:#991b1b;font-weight:600}
  #usb-dialog .usb-meter{display:flex;align-items:baseline;gap:.75rem;margin-bottom:.4rem}
  #usb-dialog .usb-percent{font-size:2.25rem;font-weight:700;line-height:1;font-variant-numeric:tabular-nums;min-width:4.5ch}
  #usb-dialog .usb-figures{color:#475569;font-size:.85rem;font-variant-numeric:tabular-nums}
  #usb-dialog .usb-bar{height:.6rem;border-radius:999px;background:#e2e8f0;overflow:hidden}
  #usb-dialog .usb-bar span{display:block;height:100%;width:0;background:#2563eb;transition:width .4s ease}
  #usb-dialog[data-state="ready"] .usb-bar span{background:#16a34a}
  #usb-dialog[data-state="failed"] .usb-bar span{background:#dc2626}
  #usb-dialog .usb-message{margin:.9rem 0 0;min-height:1.4em}
  #usb-dialog[data-state="failed"] .usb-message{color:#b91c1c}
  #usb-dialog[data-state="ready"] .usb-message{color:#166534;font-weight:600}
  #usb-dialog .usb-hint{margin:.4rem 0 0;color:#64748b;font-size:.85rem}
  #usb-dialog .usb-hint:empty{display:none}
  @media (prefers-reduced-motion:reduce){#usb-dialog .usb-bar span{transition:none}}`;
  document.head.append(style);
}

// ---------- progress dialog ----------

let dialog = null, timer = null, generation = 0;

function buildDialog() {
  dialog = document.createElement('dialog');
  dialog.id = 'usb-dialog';
  dialog.setAttribute('aria-labelledby', 'usb-title');
  dialog.innerHTML = `
    <div class="dialog-heading">
      <div><p class="eyebrow">USB TRANSFER</p><h2 id="usb-title">Export to USB drive</h2></div>
      <button type="button" class="usb-close" aria-label="Close">×</button>
    </div>
    <p class="usb-location"></p>
    <ol class="usb-steps" aria-label="Export stages"></ol>
    <div class="usb-meter"><span class="usb-percent">0%</span><span class="usb-figures"></span></div>
    <div class="usb-bar" role="progressbar" aria-label="USB export progress" aria-valuemin="0" aria-valuemax="100"><span></span></div>
    <p class="usb-message" role="status"></p>
    <p class="usb-hint"></p>
    <div class="dialog-actions">
      <button type="button" class="usb-dismiss">Close</button>
      <button type="button" class="primary usb-start">Start export</button>
    </div>`;
  document.body.append(dialog);
  const close = () => dialog.close();
  dialog.querySelector('.usb-close').addEventListener('click', close);
  dialog.querySelector('.usb-dismiss').addEventListener('click', close);
  dialog.addEventListener('close', () => { generation++; clearTimeout(timer); });
  closeOnBackdrop(dialog, close);
}

export function openUsbDialog(inspection, ctx, { initial, canStart, onUpdate }) {
  ensureStyle();
  if (!dialog) buildDialog();
  clearTimeout(timer);
  const gen = ++generation;
  let state = initial || { state: 'not_started' }, busy = false, error = '';
  let sample = null; // computed in the browser if the server reports no speed

  const q = s => dialog.querySelector(s);
  q('.usb-location').textContent =
    `${inspection.plant} / ${inspection.turbine} · Blade ${inspection.blade} / ${sectionLabel(inspection.section)}`;

  const startButton = q('.usb-start');
  const replaced = startButton.cloneNode(true); // drop the listener of the previous inspection
  startButton.replaceWith(replaced);
  replaced.addEventListener('click', start);

  function speedOf(u) {
    if (u.speed_bps > 0) return u.speed_bps;
    const now = Date.now();
    if (sample && sample.stage === u.stage && u.bytes_done > sample.bytes) {
      const v = (u.bytes_done - sample.bytes) / ((now - sample.at) / 1000);
      sample = { stage: u.stage, bytes: u.bytes_done, at: now, speed: v };
      return v;
    }
    if (!sample || sample.stage !== u.stage) sample = { stage: u.stage, bytes: u.bytes_done, at: now, speed: 0 };
    return sample.speed || 0;
  }

  function render() {
    const s = state.state;
    dialog.dataset.state = s;
    const current = stepIndex(state.stage);
    const steps = q('.usb-steps');
    steps.replaceChildren(...STEPS.map((step, i) => {
      const li = document.createElement('li');
      li.textContent = step.title;
      li.dataset.state = s === 'ready' ? 'done'
        : s === 'failed' ? (i < current ? 'done' : i === current ? 'error' : 'pending')
        : active(state) ? (i < current ? 'done' : i === current ? 'active' : 'pending')
        : 'pending';
      return li;
    }));

    const pct = overallPercent(state);
    q('.usb-percent').textContent = s === 'not_started' ? '—' : `${pct}%`;
    q('.usb-bar span').style.width = `${s === 'not_started' ? 0 : pct}%`;
    q('.usb-bar').setAttribute('aria-valuenow', String(pct));

    let figures = '';
    if (s === 'running' && ['writing', 'verifying'].includes(state.stage) && state.bytes_total > 0) {
      const speed = speedOf(state);
      figures = `${mb(state.bytes_done)} / ${mb(state.bytes_total)}`;
      if (speed > 0) {
        figures += ` · ${(speed / 1e6).toFixed(1)} MB/s`;
        const left = duration((state.bytes_total - state.bytes_done) / speed);
        if (left) figures += ` · ~${left} left in this stage`;
      }
    } else if (s === 'ready' && state.bytes_total > 0) {
      figures = `${mb(state.bytes_total)} exported`;
    }
    q('.usb-figures').textContent = figures;

    const allowed = canStart();
    let message = '', hint = '';
    if (s === 'not_started') {
      message = 'The videos and photos of this inspection will be written to the drive as one ZIP file.';
      hint = allowed ? 'Make sure a USB drive is plugged in.'
        : 'Download the recordings to the Jetson first. USB export becomes available when the download is complete.';
    } else if (active(state)) {
      message = STAGE_TEXT[state.stage] ?? state.stage;
      hint = 'You can close this window; the export continues in the background. Do not remove the drive until it finishes.';
    } else if (s === 'ready') {
      message = `Export complete and verified: ${state.zip_name}`;
      hint = 'The drive has been ejected. You can remove it safely.';
    } else if (s === 'failed') {
      message = state.message || 'USB export failed.';
      hint = 'Fix the problem and try again. Any partial file is removed from the drive.';
    }
    q('.usb-message').textContent = error || message;
    q('.usb-hint').textContent = hint;

    const button = q('.usb-start');
    button.hidden = active(state);
    button.textContent = s === 'failed' ? 'Try again' : s === 'ready' ? 'Export again' : 'Start export';
    button.disabled = busy || !allowed;
    q('.usb-dismiss').textContent = active(state) ? 'Continue in background' : 'Close';
  }

  async function start() {
    if (busy) return;
    busy = true; error = ''; render();
    try {
      state = (await ctx.request(path(inspection.request_id), {})).usb_upload;
      sample = null;
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
      const next = (await ctx.request(path(inspection.request_id))).usb_upload;
      if (gen !== generation || !dialog.open) return;
      const changed = next.state !== state.state;
      state = next; error = '';
      render();
      if (changed || !active(state)) onUpdate(state);
    } catch (e) {
      if (gen === generation && dialog.open) q('.usb-hint').textContent = 'Could not get status: ' + e.message;
    }
    schedule();
  }

  render();
  if (!dialog.open) dialog.showModal();
  schedule();
}

// ---------- row button ----------

function applyPill(row, inspection) {
  if (!row || inspection.state !== 'succeeded' || row.dataset.usbState !== 'ready') return;
  const pill = row.querySelector('td:nth-child(4) .pill');
  if (pill && pill.textContent !== 'USB Transferred') {
    pill.textContent = 'USB Transferred';
    pill.dataset.state = 'succeeded';
  }
}

export function mountRowUsb(cell, inspection, ctx) {
  ensureStyle();
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inspection-usb-button';
  button.setAttribute('aria-haspopup', 'dialog');
  cell.append(button);

  let state = inspection.usb_upload || { state: 'not_started' }, timer = null;
  const downloadReady = () => cell.querySelector('.inspection-download-button')?.dataset.state === 'ready';
  const canStart = () => downloadReady() && ctx.getMe()?.role !== 'viewer'
    && ['succeeded', 'aborted', 'canceled'].includes(inspection.state);

  function render() {
    const s = state.state;
    button.textContent = s === 'running' ? `USB ${overallPercent(state)}%`
      : s === 'queued' ? 'USB: queued'
      : s === 'ready' ? 'USB ✓'
      : s === 'failed' ? 'USB: failed'
      : 'Export to USB';
    button.dataset.state = s;
    // Always openable once there is a status; a new export needs a finished download.
    button.disabled = s === 'not_started' && !canStart();
    button.title = s === 'ready' ? `Exported to USB: ${state.zip_name}`
      : s === 'failed' ? (state.message || 'USB export failed')
      : s === 'not_started' && !canStart() ? 'Download the recordings to the Jetson first.'
      : 'USB export details';
    button.setAttribute('aria-label', `${sectionLabel(inspection.section)}: ${button.textContent}`);
    const row = button.closest('tr');
    if (row) { row.dataset.usbState = s; applyPill(row, inspection); }
  }

  function schedule() {
    clearTimeout(timer);
    if (button.isConnected && active(state)) timer = setTimeout(poll, 2000);
  }
  async function poll() {
    if (!button.isConnected) return;
    const hidden = button.closest('.inspection-group-content')?.hidden;
    if (!hidden && !document.hidden) {
      try { state = (await ctx.request(path(inspection.request_id))).usb_upload; render(); }
      catch (e) { button.title = e.message; }
    }
    schedule();
  }

  button.addEventListener('click', () => openUsbDialog(inspection, ctx, {
    initial: state, canStart,
    onUpdate: next => { state = next; render(); schedule(); },
  }));

  render();
  // The caller appends the row to the table after this function returns.
  queueMicrotask(() => {
    const download = cell.querySelector('.inspection-download-button');
    if (download) new MutationObserver(render).observe(download, { attributes: true, attributeFilter: ['data-state'] });
    const row = button.closest('tr');
    const tracking = row?.querySelector('.tracking-button');
    if (tracking) new MutationObserver(() => applyPill(row, inspection))
      .observe(tracking, { childList: true, subtree: true, characterData: true });
    render();
    schedule();
  });
}
