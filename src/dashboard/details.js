import { $, node } from '../lib/dom.js';
import { date } from '../lib/format.js';
import { send as request } from '../lib/api.js';
import { pill } from './status.js';

// "Details" dialog: inspection facts and links to its media files.
const ASSET_LABELS = { preview: 'Preview MP4', native_insv: 'Original INSV', native_photo: 'Original photo' };

export async function openDetails(id) {
  const dialog = $('detail-dialog');
  $('detail-title').textContent = 'Loading…';
  $('detail-body').replaceChildren();
  dialog.showModal();
  try {
    const d = await request('/api/inspections/' + id);
    if (!dialog.open) return;
    const r = d.inspection;
    $('detail-title').textContent = r.plant + ' / ' + r.turbine;
    $('detail-title').append(pill(r.state));

    const grid = node('div', undefined, 'detail-grid');
    for (const [key, value] of [['Operator', r.operator_name_snapshot], ['Blade / Section', r.blade + ' / ' + r.section],
      ['Started', date(r.created_at)], ['Finished', date(r.finished_at)]]) {
      const p = node('p');
      p.append(node('small', key), document.createTextNode(value));
      grid.append(p);
    }
    const out = $('detail-body');
    out.append(grid, node('h3', 'Recordings'));
    if (!d.assets.length) out.append(node('p', 'No media files available.', 'muted'));
    for (const a of d.assets) {
      const row = node('div', undefined, 'asset');
      row.append(node('span', (ASSET_LABELS[a.kind] || 'Native recording metadata') + ' · ' + (a.size_bytes / 1048576).toFixed(1) + ' MB'));
      const link = node('a', 'Open ↗');
      link.href = '/api/assets/' + a.id;
      link.target = '_blank';
      link.rel = 'noopener';
      row.append(link);
      out.append(row);
    }
  } catch (e) {
    $('detail-title').textContent = 'Could not load details';
    $('detail-body').textContent = e.message;
  }
}
