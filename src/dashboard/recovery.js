import { node } from '../lib/dom.js';
import { send as request } from '../lib/api.js';
import { sectionLabel } from '../lib/format.js';

// Unlock & Recover (backend: inspection/lockRecovery.js). The dashboard banner
// shows a locked robot, the dialog runs the recovery job and follows its steps,
// and Details shows recovered inspections and links their camera file.
const STEPS = [
  ['check', 'Check robot state'],
  ['camera', 'Camera reachable and idle'],
  ['unlock', 'Clear the lock'],
  ['preview', 'Rebuild the preview'],
  ['manifest', 'Close the recording files'],
  ['database', 'Save the inspection'],
];
const ORDER = STEPS.map(([key]) => key);
const time = ms => (ms ? new Date(ms).toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul' }) : '');
const stamp = ms => new Date(ms).toLocaleString('en-GB', { timeZone: 'Europe/Istanbul' });
const place = i => `${i.plant} / ${i.turbine} / Blade ${i.blade} / ${sectionLabel(i.section)}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function ensureStyle() {
  if (document.getElementById('recovery-style')) return;
  const style = document.createElement('style');
  style.id = 'recovery-style';
  style.textContent = `
  #recovery-dialog{width:min(560px,94vw)}
  #recovery-dialog h2{margin:0 0 4px}
  .recovery-note p{margin:6px 0;font-size:13px;line-height:1.5;color:#41546b}
  .recovery-note p:last-child{padding:8px 10px;border-radius:8px;background:#fff5e3;color:#795218}
  .recovery-steps{list-style:none;margin:14px 0;padding:0;display:grid;gap:6px;font-size:13px}
  .recovery-steps li{display:flex;align-items:center;gap:8px;color:#697c88}
  .recovery-steps li::before{content:'';width:10px;height:10px;border-radius:50%;background:#d6dde4;flex:none}
  .recovery-steps li[data-state=active]{color:#2a6798;font-weight:600}
  .recovery-steps li[data-state=active]::before{background:#2a6798}
  .recovery-steps li[data-state=done]{color:#24364b}
  .recovery-steps li[data-state=done]::before{background:#267244}
  .recovery-steps li[data-state=warn]::before{background:#d39b2a}
  .recovery-steps li[data-state=error]{color:#b42318}
  .recovery-steps li[data-state=error]::before{background:#b42318}
  .recovery-steps small{font-weight:400;color:#697c88}
  .recovery-message{font-size:13px;min-height:1em;line-height:1.5}
  .recovery-message[data-state=ok]{color:#267244}
  .recovery-message[data-state=error]{color:#b42318}
  .recovery-actions{display:flex;justify-content:flex-end;gap:8px}
  .recovery-box{margin:14px 0 4px;padding:12px 14px;border-radius:10px;background:#fff5e3;border:1px solid #f3dfb7;color:#795218;font-size:13px}
  .recovery-box p{margin:6px 0;line-height:1.5}
  .candidate-list{display:grid;gap:6px;margin:8px 0}
  .candidate-list label{display:flex;gap:8px;align-items:center;padding:6px 8px;border:1px solid #e2e8f0;border-radius:8px;background:#fff;color:#24364b;cursor:pointer}
  .candidate-list small{color:#697c88;margin-left:auto}
  .recovery-error{color:#b42318}`;
  document.head.append(style);
}

// ---------- Dashboard banner ----------
export function lockBanner(lock, me, retrieve) {
  ensureStyle();
  const fragment = document.createDocumentFragment();
  const i = lock.inspection;
  const cause = (lock.reasons || []).some(r => r.source === 'camera')
    ? 'The camera connection was lost during the recording.'
    : 'The recording could not be closed cleanly.';
  fragment.append(node('span', i
    ? `Robot locked: ${place(i)} was interrupted${lock.at ? ' at ' + time(lock.at) : ''}. ${cause} ` +
      'New inspections are blocked until it is recovered.'
    : `Robot locked after an uncertain recording shutdown. ${cause} New inspections are blocked.`));
  const actions = node('div', undefined, 'banner-actions');
  if (lock.can_unlock && i) {
    const button = node('button', 'Unlock & Recover', 'banner-recover');
    button.type = 'button';
    button.addEventListener('click', () => openRecovery(i.request_id, place(i)));
    actions.append(button);
  } else if (me?.role !== 'viewer') {
    actions.append(node('span', i ? `Ask ${i.operator} or an administrator to unlock.` : 'Ask an administrator to unlock.'));
  }
  if (retrieve?.mine || (retrieve?.available && !retrieve.active)) {
    const drive = node('button', retrieve.mine ? 'Continue driving back' : 'Drive back with webcam', 'banner-recover');
    drive.type = 'button';
    drive.addEventListener('click', async () => {
      drive.disabled = true;
      try {
        if (!retrieve.mine) await request('/api/robot/drive-back', { action: 'start' });
        location.assign('/inspection');
      } catch (e) { drive.disabled = false; drive.textContent = e.message; }
    });
    actions.prepend(drive);
  }
  fragment.append(actions);
  return fragment;
}

// ---------- Progress dialog ----------
let dialog = null;
function getDialog() {
  ensureStyle();
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'recovery-dialog';
    document.body.append(dialog);
  }
  return dialog;
}

function renderSteps(list, job, log) {
  const steps = log?.steps || {};
  const reached = job ? ORDER.indexOf(job.step) : -1;
  list.replaceChildren(...STEPS.map(([key, label], index) => {
    const entry = steps[key];
    let state = 'pending', note = '';
    if (job?.state === 'failed' && job.step === key) state = 'error';
    else if (entry?.ok === false) state = key === 'preview' ? 'warn' : 'error';
    else if (entry || log?.done || job?.state === 'done' || (reached > index)) state = 'done';
    else if (job?.state === 'running' && reached === index) state = 'active';
    if (key === 'camera' && entry?.was_recording) note = 'recording stopped';
    if (key === 'unlock' && entry?.skipped) note = 'was not locked';
    if (key === 'preview' && entry) note = entry.ok ? `${entry.duration_s ?? '?'} s kept` : (entry.note || 'not recovered');
    if (key === 'manifest' && entry) note = entry.complete ? 'camera file linked' : 'camera file not identified yet';
    const li = node('li', label);
    li.dataset.state = state;
    if (note) li.append(node('small', ' · ' + note));
    return li;
  }));
}

export function openRecovery(id, title, onClose) {
  const d = getDialog();
  const intro = node('div', undefined, 'recovery-note');
  intro.append(
    node('p', 'This checks the camera, clears the robot lock, rebuilds the preview from what was recorded ' +
      'and closes the inspection as recovered.'),
    node('p', 'Before you start: if the camera is still recording, stop the recording on the camera, ' +
      'then unplug and replug its USB cable.'));
  const list = node('ol', undefined, 'recovery-steps');
  const message = node('p', '', 'recovery-message');
  message.setAttribute('role', 'status');
  const start = node('button', 'Start', 'primary');
  const close = node('button', 'Cancel');
  start.type = close.type = 'button';
  const actions = node('div', undefined, 'recovery-actions');
  actions.append(close, start);
  d.replaceChildren(node('h2', 'Unlock & Recover'), node('p', title || '', 'muted'), intro, list, message, actions);
  renderSteps(list, null, null);

  let running = false;
  close.addEventListener('click', () => d.close());
  d.addEventListener('close', () => {
    document.dispatchEvent(new CustomEvent('inspections-changed'));
    onClose?.();
  }, { once: true });

  const finish = (ok, text) => {
    running = false;
    message.textContent = text;
    message.dataset.state = ok ? 'ok' : 'error';
    close.disabled = false;
    close.textContent = 'Close';
    start.disabled = false;
    start.hidden = ok;
    start.textContent = 'Try again';
  };

  start.addEventListener('click', async () => {
    if (running) return;
    running = true;
    start.disabled = close.disabled = true;
    start.textContent = 'Working…';
    message.textContent = '';
    message.dataset.state = '';
    try {
      await request(`/api/inspections/${id}/unlock-recover`, {});
    } catch (e) {
      finish(false, e.message);
      return;
    }
    let misses = 0;
    for (;;) {
      await sleep(1000);
      let s;
      try { s = await request(`/api/inspections/${id}/unlock-recover`); misses = 0; }
      catch (e) {
        if (++misses >= 15) { finish(false, 'Lost contact with the backend: ' + e.message); return; }
        continue;
      }
      renderSteps(list, s.job, s.log);
      if (s.job?.state === 'done') { finish(true, s.job.message); return; }
      if (s.job?.state === 'failed') { finish(false, s.job.message); return; }
      if (!s.job && s.log?.done) { finish(true, 'This inspection was recovered.'); return; }
    }
  });
  if (!d.open) d.showModal();
}

// ---------- Details ----------
function cameraPicker(id, reload) {
  const wrap = node('div');
  const find = node('button', 'Find camera file…');
  find.type = 'button';
  const out = node('div');
  find.addEventListener('click', async () => {
    find.disabled = true;
    find.textContent = 'Reading the camera…';
    out.replaceChildren();
    try {
      const c = await request(`/api/inspections/${id}/recovery/camera-candidates`);
      if (!c.candidates.length) { out.append(node('p', 'No unlinked video was found on the camera.')); return; }
      const list = node('div', undefined, 'candidate-list');
      c.candidates.forEach((x, index) => {
        const label = node('label');
        const radio = node('input');
        radio.type = 'radio';
        radio.name = 'camera-candidate';
        radio.value = x.file;
        if (index === 0 && x.diff_s !== null && Math.abs(x.diff_s) <= 120) radio.checked = true;
        const when = x.estimated_start ? time(x.estimated_start) : 'time unknown';
        const diff = x.diff_s === null ? ''
          : Math.abs(x.diff_s) < 60 ? `${Math.abs(x.diff_s)} s from the start`
          : `${Math.round(Math.abs(x.diff_s) / 60)} min ${x.diff_s < 0 ? 'earlier' : 'later'}`;
        label.append(radio, node('strong', x.file.split('/').pop()), node('small', when + (diff ? ' · ' + diff : '')));
        list.append(label);
      });
      const link = node('button', 'Link selected file', 'primary');
      link.type = 'button';
      const msg = node('p');
      link.addEventListener('click', async () => {
        const chosen = list.querySelector('input:checked')?.value;
        if (!chosen) { msg.textContent = 'Select a file first.'; return; }
        link.disabled = true;
        msg.textContent = 'Linking…';
        try {
          await request(`/api/inspections/${id}/recovery/camera-file`, { file: chosen });
          document.dispatchEvent(new CustomEvent('inspections-changed'));
          reload();
        } catch (e) {
          msg.textContent = e.message;
          link.disabled = false;
        }
      });
      out.append(node('p', 'Choose the video recorded for this inspection. The closest match by time is selected.'),
        list, link, msg);
    } catch (e) {
      out.append(node('p', e.message, 'recovery-error'));
    } finally {
      find.disabled = false;
      find.textContent = 'Find camera file…';
    }
  });
  wrap.append(find, out);
  return wrap;
}

export function recoveryBlocks(d, reload) {
  ensureStyle();
  const r = d.inspection, canAct = document.body.dataset.role !== 'viewer';
  let info = {};
  try { info = JSON.parse(r.recovery_json || '{}'); } catch {}
  if (r.recovered_at) {
    const box = node('section', undefined, 'recovery-box');
    box.append(node('strong', 'Recovered inspection'), node('p',
      `The recording was interrupted${info.interrupted_at ? ' at ' + time(info.interrupted_at) : ''} and recovered ` +
      `by ${info.by || 'an operator'} on ${stamp(r.recovered_at)}. ` +
      (info.preview?.ok ? `The preview covers ${info.preview.duration_s} s up to the interruption.` : 'No preview could be recovered.')));
    if (!info.complete) {
      box.append(node('p', 'The 360° video on the camera is not linked yet, so it cannot be downloaded or exported.'));
      if (canAct) box.append(cameraPicker(r.request_id, reload));
    }
    return [box];
  }
  const interrupted = r.state === 'aborted' && (d.camera?.state === 'error' || d.native?.complete === false);
  if (interrupted && canAct) {
    const box = node('section', undefined, 'recovery-box');
    const button = node('button', 'Recover this inspection…');
    button.type = 'button';
    button.addEventListener('click', () => openRecovery(r.request_id, place(r), reload));
    box.append(node('strong', 'Interrupted recording'),
      node('p', 'The recording did not close normally. Recovery keeps what was recorded and marks the inspection as recovered.'),
      button);
    return [box];
  }
  return [];
}
