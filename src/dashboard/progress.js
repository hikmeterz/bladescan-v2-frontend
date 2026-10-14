import { node, closeOnBackdrop } from '../lib/dom.js';
import { date } from '../lib/format.js';
import { send as request } from '../lib/api.js';
import { pill } from './status.js';
import { downloadTimelineStep } from './download-transfer.js';
import { usbTimelineStep } from './usb-transfer.js';

// "Inspection Progress" timeline dialog, refreshed every 3 s while open.
let dialog = null, timer = null, generation = 0;
const q = selector => dialog.querySelector(selector);

function build() {
  dialog = document.createElement('dialog');
  dialog.id = 'inspection-progress';
  dialog.setAttribute('aria-labelledby', 'progress-title');
  dialog.innerHTML = `
    <div class="dialog-heading">
      <div><p class="eyebrow">INSPECTION TRACKING</p><h2 id="progress-title">Inspection Progress</h2></div>
      <button type="button" class="progress-close" aria-label="Close">×</button>
    </div>
    <p class="progress-location"></p>
    <p class="progress-error" role="status"></p>
    <ol class="progress-timeline"></ol>
    <p class="progress-updated"></p>`;
  document.body.append(dialog);
  q('.progress-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { generation++; clearTimeout(timer); });
  closeOnBackdrop(dialog);
}

const checkedNow = () => 'Last checked: ' + new Date().toLocaleTimeString('en-GB');

export function openInspectionProgress(id) {
  if (!dialog) build();
  clearTimeout(timer);
  const mine = ++generation;
  delete dialog.dataset.fingerprint;
  q('.progress-location').textContent = 'Loading…';
  q('.progress-timeline').replaceChildren();
  q('.progress-error').textContent = '';
  q('.progress-updated').textContent = '';
  if (!dialog.open) dialog.showModal();

  async function update() {
    try {
      const data = await request('/api/inspections/' + encodeURIComponent(id));
      if (mine !== generation || !dialog.open) return;
      const r = data.inspection;
      const fingerprint = JSON.stringify([r?.request_id, r?.state, r?.started_at, r?.finished_at,
        data.events, data.download, data.usb_upload]);
      if (dialog.dataset.fingerprint !== fingerprint) {
        render(data);
        dialog.dataset.fingerprint = fingerprint;
      } else {
        q('.progress-error').textContent = '';
        q('.progress-updated').textContent = checkedNow();
      }
    } catch {
      if (mine !== generation || !dialog.open) return;
      q('.progress-error').textContent = 'Live update unavailable. Displayed progress may be outdated.';
    } finally {
      if (mine === generation && dialog.open) timer = setTimeout(update, 3000);
    }
  }
  update();
}

function steps(data) {
  const r = data.inspection;
  const events = Array.isArray(data.events) ? data.events : [];
  const eventTime = type => events.filter(e => e.event_type === type)
    .sort((a, b) => a.occurred_at - b.occurred_at)[0]?.occurred_at || null;
  const started = r.started_at || eventTime('running');
  const finished = r.finished_at || eventTime(r.state);
  const state = r.state;
  const failed = ['aborted', 'canceled', 'not_sent'].includes(state);
  const outcome = { aborted: 'Failed / Interrupted', canceled: 'Canceled', not_sent: 'Not sent', unknown: 'Outcome unknown' }[state];

  const list = [{
    title: 'Started',
    status: started ? 'done' : failed ? 'error' : state === 'unknown' ? 'warning' : 'active',
    detail: started ? 'Inspection started.'
      : state === 'not_sent' ? 'The request was not sent.'
      : failed ? 'Start was not confirmed.'
      : state === 'unknown' ? 'Start could not be confirmed.'
      : 'Waiting for start confirmation.',
    time: started,
  }];
  if (state === 'succeeded') {
    list.push({ title: 'Completed', status: 'done', detail: 'Inspection completed successfully.', time: finished });
  } else if (failed || state === 'unknown') {
    list.push({
      title: outcome, status: state === 'unknown' ? 'warning' : 'error',
      detail: state === 'unknown' ? 'The inspection outcome requires verification.' : 'The inspection did not complete successfully.',
      time: state === 'unknown' ? eventTime('unknown') : finished,
    });
  } else {
    list.push({
      title: state === 'finalizing' ? 'Finalizing' : 'Completed',
      status: started || state === 'finalizing' ? 'active' : 'pending',
      detail: state === 'finalizing' ? 'Closing recordings and checking files.'
        : started ? 'Inspection is in progress.' : 'Waiting for completion.',
      time: null,
    });
  }
  list.push(downloadTimelineStep(data.download), usbTimelineStep(data.usb_upload),
    { title: 'Report Created', status: 'pending', detail: 'Not integrated · Report generation is not connected.' });
  return list;
}

const MARKERS = { done: '✓', error: '×', warning: '!', active: '•', pending: '○' };
const STATUS_TEXT = { done: 'Confirmed', error: 'Stopped', warning: 'Unconfirmed', active: 'In progress', pending: 'Pending' };

function render(data) {
  const r = data.inspection;
  if (!r) throw Error('Missing inspection');
  q('.progress-location').textContent = `${r.plant} / ${r.turbine} · Blade ${r.blade} / Section ${r.section}`;
  q('.progress-error').textContent = '';
  q('.progress-timeline').replaceChildren(...steps(data).map(step => {
    const li = node('li', undefined, 'progress-step');
    li.dataset.state = step.status;
    const marker = node('span', MARKERS[step.status], 'progress-marker');
    marker.setAttribute('aria-hidden', 'true');
    const body = node('div', undefined, 'progress-content');
    const heading = node('div', undefined, 'progress-step-heading');
    heading.append(node('strong', step.title), node('span', STATUS_TEXT[step.status], 'progress-step-status'));
    body.append(heading, node('p', step.detail));
    if (step.time) body.append(node('small', date(step.time)));
    li.append(marker, body);
    return li;
  }));
  q('.progress-updated').textContent = checkedNow();
  // Keep the row's state pill in step with what the timeline shows.
  for (const button of document.querySelectorAll('.tracking-button')) {
    if (button.dataset.inspectionId === r.request_id) button.replaceChildren(pill(r.state), node('span', ' ›'));
  }
}
