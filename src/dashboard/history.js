import { $, node } from '../lib/dom.js';
import { date, meters } from '../lib/format.js';
import { send as request } from '../lib/api.js';
import { pill } from './status.js';
import { mountDownloadRow } from './download-transfer.js';
import { mountRowUsb } from './usb-transfer.js';

// Inspection history: groups (day · plant / turbine · blade) that expand into
// one row per section, with search, state filter and pagination.
const PAGE_SIZE = 12;
const SECTION_COLUMNS = ['Section', 'Started', 'Distance', 'Status', ''];

// "2 videos · 1 photo" for a row (counts come with the list). Where the files
// are is shown by the Download button, the timeline and Details.
function mediaLine(m) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(m.videos, 'video')} · ${plural(m.photos, 'photo')}`;
}

export function createHistory({ getMe, onDetails, onProgress, selection }) {
  let page = 1, pages = 1, epoch = 0;
  const expanded = new Set();
  const ctx = { request, getMe };

  function sectionRow(r) {
    const tr = node('tr', undefined, 'inspection-child');
    const location = node('td');
    const label = node('strong', 'Section ' + r.section);
    if (selection) {
      const cell = node('span', undefined, 'bulk-cell');
      cell.append(selection.rowBox(r), label);
      location.append(cell);
    } else {
      location.append(label);
    }
    if (r.media) {
      const line = node('small', mediaLine(r.media), 'media-line');
      if (selection) line.style.paddingLeft = '26px';
      location.append(line);
    }
    tr.append(location, node('td', date(r.created_at)), node('td', meters(r.distance_m)));

    const state = node('td'), tracking = node('button', undefined, 'tracking-button');
    tracking.type = 'button';
    tracking.dataset.inspectionId = r.request_id;
    tracking.setAttribute('aria-label', 'View inspection progress');
    tracking.setAttribute('aria-haspopup', 'dialog');
    tracking.append(pill(r.state), node('span', ' ›'));
    tracking.addEventListener('click', () => onProgress(r.request_id));
    state.append(tracking);
    tr.append(state);

    const actions = node('td', undefined, 'inspection-row-actions'), details = node('button', 'Details →');
    details.addEventListener('click', () => onDetails(r.request_id));
    actions.append(details);
    mountDownloadRow(actions, r, ctx);
    mountRowUsb(actions, r, ctx);
    tr.append(actions);
    return tr;
  }

  function groupRows(g) {
    const header = node('tr', undefined, 'inspection-group'), cell = node('td');
    cell.colSpan = 5;
    const toggle = node('button', undefined, 'inspection-group-toggle'), arrow = node('span');
    toggle.type = 'button';
    arrow.setAttribute('aria-hidden', 'true');
    const day = g.day?.split('-').reverse().join('.') || 'Unknown date';
    toggle.append(arrow, node('strong', `${day} · ${g.plant} / ${g.turbine} · Blade ${g.blade}`),
      node('span', `${g.count} inspections`, 'group-count'));
    if (selection) {
      const wrap = node('div', undefined, 'bulk-group');
      wrap.append(selection.groupBox(g), toggle);
      cell.append(wrap);
    } else {
      cell.append(toggle);
    }
    header.append(cell);

    const content = node('tr', undefined, 'inspection-group-content'), contentCell = node('td');
    contentCell.colSpan = 5;
    const inset = node('div', undefined, 'inspection-group-inset'), table = node('table', undefined, 'inspection-section-table');
    table.setAttribute('aria-label', `${g.plant} / ${g.turbine} / Blade ${g.blade} / ${g.day}`);
    const head = node('thead'), headRow = node('tr'), body = node('tbody');
    for (const text of SECTION_COLUMNS) {
      const th = node('th', text);
      th.scope = 'col';
      if (!text) th.append(node('span', 'Action', 'sr-only'));
      headRow.append(th);
    }
    head.append(headRow);
    table.append(head, body);
    inset.append(table);
    contentCell.append(inset);
    content.append(contentCell);

    const paint = () => {
      const open = expanded.has(g.key);
      toggle.setAttribute('aria-expanded', String(open));
      arrow.textContent = open ? '▾' : '▸';
      content.hidden = !open;
    };
    toggle.addEventListener('click', () => {
      if (!expanded.delete(g.key)) expanded.add(g.key);
      paint();
    });
    // Rows are appended to the page before the per-row widgets look up their <tr>.
    return { rows: [header, content], fill: () => { for (const r of g.items) body.append(sectionRow(r)); paint(); } };
  }

  async function load() {
    const mine = ++epoch;
    $('count').textContent = 'Loading inspections…';
    try {
      const params = new URLSearchParams({ page, page_size: PAGE_SIZE, grouped: '1', q: $('query').value, state: $('state').value });
      const data = await request('/api/inspections?' + params);
      if (mine !== epoch) return;
      pages = data.pages;
      page = data.page;
      $('rows').replaceChildren();
      $('empty').hidden = !!data.groups.length;
      for (const g of data.groups) {
        const group = groupRows(g);
        $('rows').append(...group.rows);
        group.fill();
      }
      $('count').textContent = data.total + ' groups';
      $('page').textContent = page + ' / ' + pages;
      $('prev').disabled = page <= 1;
      $('next').disabled = page >= pages;
    } catch (e) {
      $('message').textContent = e.message;
      $('count').textContent = 'Could not load inspections.';
    }
  }

  // Filters apply as you type (debounced) or change the state.
  let filterTimer;
  const applyFilters = () => { clearTimeout(filterTimer); page = 1; load(); };
  $('filters').addEventListener('submit', e => { e.preventDefault(); applyFilters(); });
  $('state').addEventListener('change', applyFilters);
  $('query').addEventListener('input', () => { clearTimeout(filterTimer); filterTimer = setTimeout(applyFilters, 300); });
  $('prev').addEventListener('click', () => { if (page > 1) { page--; load(); } });
  $('next').addEventListener('click', () => { if (page < pages) { page++; load(); } });

  return { load };
}
