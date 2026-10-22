// Blade view on the inspection screen: where the robot is inside the blade.
//
// The blade is drawn from root (left) to tip (right) and split along its length
// into the leading-edge and trailing-edge cavities; the inspected one (section
// L or T) is highlighted and the robot moves along it with the odometry
// distance. The blade length is not known, so unless a length is given the
// scale grows with the distance travelled and no percentage is shown.
import { createBlade3D } from './blade-view-3d.js';

const NS = 'http://www.w3.org/2000/svg';
const W = 560, H = 132, X0 = 46, X1 = 540, MID = 58;
const SECTIONS = { L: 'Leading edge', T: 'Trailing edge' };

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.append(n);
  return n;
};

// Planform outline: round root, widest chord at ~25 %, slim tip. y(t) for t = 0..1.
function halfChord(t) {
  if (t < 0.06) return 16;
  if (t < 0.25) return 16 + (t - 0.06) / 0.19 * 22;
  const hc = 38 - (t - 0.25) / 0.75 * 32;
  return t > 0.95 ? hc * Math.max(0.12, (1 - t) / 0.05) : hc;   // rounded tip
}
// The leading edge is straighter than the trailing edge (as on a real blade).
const lead = t => MID - halfChord(t) * 0.8;
const trail = t => MID + halfChord(t) * 1.2;
const spar = t => MID + (t < 0.06 ? 0 : halfChord(t) * 0.05);
const x = t => X0 + t * (X1 - X0);

function path(top, bottom, from = 0, to = 1) {
  const steps = 40, pts = [];
  for (let i = 0; i <= steps; i++) { const t = from + (to - from) * i / steps; pts.push(`${x(t).toFixed(1)},${top(t).toFixed(1)}`); }
  for (let i = steps; i >= 0; i--) { const t = from + (to - from) * i / steps; pts.push(`${x(t).toFixed(1)},${bottom(t).toFixed(1)}`); }
  return 'M' + pts.join(' L') + ' Z';
}

function niceSpan(distance, length) {
  if (Number.isFinite(length) && length > 0) return length;
  const need = Math.max(20, distance * 1.25);
  const step = need <= 40 ? 10 : need <= 100 ? 20 : 50;
  return Math.ceil(need / step) * step;
}

export function createBladeView(root) {
  if (!root) return { update() {} };
  root.innerHTML = `
    <div class="blade-head">
      <span class="blade-title"><svg class="blade-airfoil" viewBox="0 0 64 22" aria-hidden="true">
        <path class="af-l" d="M23 3.5 C12 3.5 3 7 3 11 C3 15 12 18.5 23 18.5 Z"/>
        <path class="af-t" d="M23 3.5 C36 3.5 50 7.5 61 12.5 C50 14.5 36 18.5 23 18.5 Z"/>
        <path class="af-outline" d="M3 11 C3 7 12 3.5 23 3.5 C36 3.5 50 7.5 61 12.5 C50 14.5 36 18.5 23 18.5 C12 18.5 3 15 3 11 Z"/>
        <line class="af-spar" x1="23" y1="3.5" x2="23" y2="18.5"/></svg>
        Blade · <b data-k="section">—</b></span>
      <span class="blade-distance"><b data-k="distance">—</b><small data-k="note">from start</small></span>
    </div>`;
  // 3D cut-away when WebGL is available; the flat drawing below is the fallback.
  const stage = document.createElement('div'); stage.className = 'blade-3d'; root.append(stage);
  const three = createBlade3D(stage);
  if (!three) stage.remove();
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'blade-svg', role: 'img' }, three ? null : root);
  const label = el('title', {}, svg);

  el('path', { d: path(lead, trail), class: 'blade-shell' }, svg);
  const cavL = el('path', { d: path(lead, spar, 0.06, 0.985), class: 'blade-cavity' }, svg);
  const cavT = el('path', { d: path(spar, trail, 0.06, 0.985), class: 'blade-cavity' }, svg);
  const travel = el('rect', { class: 'blade-travel', rx: 2 }, svg);
  el('path', { d: `M${x(0.06)},${spar(0.06)} ` + Array.from({ length: 41 }, (_, i) => { const t = 0.06 + 0.925 * i / 40; return `L${x(t).toFixed(1)},${spar(t).toFixed(1)}`; }).join(' '), class: 'blade-spar' }, svg);
  el('ellipse', { cx: x(0), cy: MID, rx: 6, ry: 16, class: 'blade-root' }, svg);
  el('text', { x: 4, y: MID + 4, class: 'blade-end' }, svg).textContent = 'Root';
  const tipText = el('text', { x: X1 + 4, y: MID - 8, class: 'blade-end', 'text-anchor': 'end' }, svg);
  el('text', { x: X0 + 12, y: 22, class: 'blade-edge-label' }, svg).textContent = 'Leading edge';
  el('text', { x: X0 + 12, y: 112, class: 'blade-edge-label' }, svg).textContent = 'Trailing edge';
  const ticks = el('g', { class: 'blade-ticks' }, svg);
  const robot = el('g', { class: 'blade-robot' }, svg);
  el('circle', { r: 9, class: 'blade-robot-halo' }, robot);
  el('rect', { x: -6, y: -4, width: 12, height: 8, rx: 2.5, class: 'blade-robot-body' }, robot);

  let last = '';
  function update({ section, distance, fresh = true, length = null }) {
    const known = SECTIONS[section];
    const d = fresh && Number.isFinite(distance) ? Math.max(0, distance) : null;
    const span = niceSpan(d || 0, length);
    const key = [section, d?.toFixed(2), span, fresh].join('|');
    if (key === last) return;
    last = key;

    root.querySelector('[data-k="section"]').textContent = known || (section ? 'Section ' + section : 'No inspection');
    root.querySelector('[data-k="distance"]').textContent = d === null ? '—'
      : d.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m';
    root.querySelector('[data-k="note"]').textContent = Number.isFinite(length) && length > 0 && d !== null
      ? ` of ${length} m · ${Math.min(100, Math.round(d / length * 100))} %` : ' from start';
    tipText.textContent = Number.isFinite(length) && length > 0 ? 'Tip' : 'Tip →';

    root.dataset.section = known ? section : '';
    if (three) {
      three.update({ section: known ? section : null, s: d === null ? 0 : Math.min(1, d / span), span,
        known: Number.isFinite(length) && length > 0 });
      return;
    }
    cavL.classList.toggle('active', section === 'L');
    cavT.classList.toggle('active', section === 'T');

    ticks.replaceChildren();
    const step = span <= 40 ? 10 : span <= 100 ? 20 : 50;
    for (let m = 0; m <= span + 1e-6; m += step) {
      const px = x(m / span * 0.985);
      el('line', { x1: px, x2: px, y1: 119, y2: 123 }, ticks);
      el('text', { x: px, y: 131, 'text-anchor': 'middle' }, ticks).textContent = m + ' m';
    }

    const t = d === null ? 0.06 : 0.06 + Math.min(1, d / span) * (0.985 - 0.06);
    const y = section === 'T' ? (spar(t) + trail(t)) / 2 : section === 'L' ? (lead(t) + spar(t)) / 2 : MID;
    robot.setAttribute('transform', `translate(${x(t).toFixed(1)},${y.toFixed(1)})`);
    robot.style.opacity = d === null ? 0.35 : 1;
    travel.setAttribute('x', x(0.06)); travel.setAttribute('width', Math.max(0, x(t) - x(0.06)));
    travel.setAttribute('y', y - 1.5); travel.setAttribute('height', 3);
    travel.style.opacity = d ? 1 : 0;
    label.textContent = `${known || 'Blade'}: robot ${d === null ? 'position unknown' : d.toFixed(1) + ' m from the start'}`;
  }
  update({ section: null, distance: null });
  return { update };
}
