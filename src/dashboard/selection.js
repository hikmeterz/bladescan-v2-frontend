import { $, node } from '../lib/dom.js';
import { send as request } from '../lib/api.js';
import { confirmDelete } from './confirm-delete.js';

// Bulk selection: checkboxes on finished inspections and a bar with bulk
// Download / Export to USB. Each inspection still becomes its own job (and its
// own ZIP); the bar only queues them one after another and reports the result.
// The selection is kept across reloads, filters and pages until cleared.
const CLOSED = new Set(['succeeded', 'aborted', 'canceled']);
const path = (id, kind) => `/api/inspections/${encodeURIComponent(id)}/${kind}`;

const ACTIONS = {
  download: {
    label: 'Download',
    async decide(id) {
      const d = (await request(path(id, 'downloads'))).download;
      if (d.state === 'ready') return 'already downloaded';
      if (['queued', 'downloading'].includes(d.state)) return 'already in the download queue';
      return null;
    },
    start: id => request(path(id, 'downloads'), {}),
  },
  usb: {
    label: 'Export to USB',
    async decide(id) {
      const d = (await request(path(id, 'downloads'))).download;
      if (d.state !== 'ready') return 'not downloaded to the Jetson yet';
      const u = (await request(path(id, 'usb-upload'))).usb_upload;
      if (u.state === 'ready') return 'already exported to USB';
      if (['queued', 'running'].includes(u.state)) return 'already in the USB queue';
      return null;
    },
    start: id => request(path(id, 'usb-upload'), {}),
  },
  delete: {
    label: 'Delete',
    className: 'bulk-delete',
    confirm(items) {
      const notExported = items.filter(r => r.usb_upload?.state !== 'ready').length;
      return confirmDelete({
        title: `Delete ${items.length} inspection${items.length === 1 ? '' : 's'}?`,
        items: items.map(r => `${r.plant} / ${r.turbine} / Blade ${r.blade} / Section ${r.section}`),
        details: 'Their folders on the Jetson and their history are removed permanently. '
          + 'Files on the camera SD card and on USB drives are not affected.',
        warning: notExported ? `${notExported} of them have not been exported to USB: the files on the Jetson are the only downloaded copy.` : '',
      });
    },
    decide: async () => null,
    start: id => request(path(id, 'delete'), { confirm: id }),
  },
};

function ensureStyle() {
  if (document.getElementById('bulk-selection-style')) return;
  const style = document.createElement('style');
  style.id = 'bulk-selection-style';
  style.textContent = `
  .bulk-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 26px;background:#edf4fc;border-bottom:1px solid #d5e5f7;font-size:13px}
  .bulk-bar strong{color:#24364b}
  .bulk-bar .bulk-result{flex-basis:100%;margin:0;color:#41546b;font-size:12px}
  .bulk-bar .bulk-result:empty{display:none}
  .bulk-bar button{padding:7px 12px;font-size:12px}
  .bulk-bar .bulk-delete{color:#b42318;border-color:#f3b8b3}
  .bulk-check{width:16px;height:16px;margin:0 10px 0 0;padding:0;flex:none;vertical-align:-3px;cursor:pointer;accent-color:#0056b8}
  .bulk-check:disabled{cursor:not-allowed;opacity:.35}
  .bulk-cell{display:flex;align-items:center}
  .bulk-cell > strong{min-width:0}
  .bulk-group{display:flex;align-items:center;background:#fff}
  .bulk-group:has(> [aria-expanded="true"]){background:#f3f7f9}
  .bulk-group > .bulk-check{margin-left:18px}
  .bulk-group > .inspection-group-toggle{flex:1;min-width:0}`;
  document.head.append(style);
}

export function createSelection({ getMe, onDone }) {
  ensureStyle();
  const selected = new Map();             // request_id -> inspection summary
  const boxes = new Set();                // live checkboxes, re-synced on every change
  let busy = false;

  const bar = $('bulk-bar');
  const count = node('strong');
  const result = node('p', '', 'bulk-result');
  result.setAttribute('role', 'status');
  const buttons = Object.entries(ACTIONS).map(([kind, action]) => {
    const b = node('button', action.label, action.className);
    b.type = 'button';
    b.addEventListener('click', () => run(kind));
    return b;
  });
  const clear = node('button', 'Clear');
  clear.type = 'button';
  clear.addEventListener('click', () => { selected.clear(); result.textContent = ''; sync(); });
  bar.replaceChildren(count, ...buttons, clear, result);

  const selectable = r => CLOSED.has(r.state);
  const canAct = () => getMe()?.role !== 'viewer';

  function sync() {
    for (const box of [...boxes]) {
      if (!box.isConnected) { boxes.delete(box); continue; }
      box.sync();
    }
    bar.hidden = selected.size === 0 && !result.textContent;
    count.textContent = `${selected.size} selected`;
    for (const b of buttons) b.disabled = busy || !selected.size || !canAct();
    clear.disabled = busy;
  }

  // Checkbox for one inspection row.
  function rowBox(r) {
    const box = node('input', undefined, 'bulk-check');
    box.type = 'checkbox';
    box.disabled = !selectable(r);
    box.title = selectable(r) ? 'Select for bulk actions' : 'Only finished inspections can be selected';
    box.setAttribute('aria-label', `Select section ${r.section}`);
    box.sync = () => { box.checked = selected.has(r.request_id); };
    box.addEventListener('change', () => {
      if (box.checked) selected.set(r.request_id, r); else selected.delete(r.request_id);
      sync();
    });
    boxes.add(box);
    box.sync();
    return box;
  }

  // Checkbox for a whole group (all selectable sections in it).
  function groupBox(g) {
    const items = g.items.filter(selectable);
    const box = node('input', undefined, 'bulk-check');
    box.type = 'checkbox';
    box.disabled = !items.length;
    box.setAttribute('aria-label', `Select all sections of ${g.plant} / ${g.turbine} / Blade ${g.blade}`);
    box.sync = () => {
      const n = items.filter(r => selected.has(r.request_id)).length;
      box.checked = items.length > 0 && n === items.length;
      box.indeterminate = n > 0 && n < items.length;
    };
    box.addEventListener('change', () => {
      for (const r of items) { if (box.checked) selected.set(r.request_id, r); else selected.delete(r.request_id); }
      sync();
    });
    boxes.add(box);
    box.sync();
    return box;
  }

  async function run(kind) {
    if (busy || !selected.size) return;
    const action = ACTIONS[kind];
    if (action.confirm && !(await action.confirm([...selected.values()]))) return;
    busy = true;
    sync();
    const items = [...selected.values()];
    const queued = [], skipped = new Map(), failed = [];
    for (const [i, r] of items.entries()) {
      result.textContent = `${action.label}: ${i + 1} / ${items.length}…`;
      const name = `${r.plant} / ${r.turbine} / ${r.blade} / ${r.section}`;
      try {
        const reason = await action.decide(r.request_id);
        if (reason) { skipped.set(reason, (skipped.get(reason) || 0) + 1); continue; }
        await action.start(r.request_id);
        queued.push(name);
        if (kind === 'delete') selected.delete(r.request_id);
      } catch (e) {
        failed.push(`${name}: ${e.message}`);
      }
    }
    const parts = [`${queued.length} ${kind === 'delete' ? 'deleted' : 'queued'}`];
    for (const [reason, n] of skipped) parts.push(`${n} skipped (${reason})`);
    if (failed.length) parts.push(`${failed.length} failed — ${failed.join('; ')}`);
    result.textContent = `${action.label}: ${parts.join(' · ')}`;
    busy = false;
    if (!failed.length) selected.clear();
    sync();
    onDone();
  }

  sync();
  return { rowBox, groupBox };
}
