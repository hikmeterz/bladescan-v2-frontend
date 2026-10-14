import { $, closeOnBackdrop } from '../lib/dom.js';

// "Hardware Status" button and dialog. Polls /api/hardware/status every 3 s.
const DEVICES = [
  ['motors', 'Motors'], ['thermal', 'Thermal'], ['dslr', 'DSLR Camera'], ['imu', 'IMU'],
  ['lidar', 'LiDAR'], ['realsense', 'RealSense Camera'], ['insta360', 'Insta360'], ['lidar3d', '3D LiDAR'],
];
const READINGS = [['robot_temp', 'Robot Temperature', '°C'], ['led_temp', 'LED Temperature', '°C'],
  ['battery_percentage', 'Battery Percentage', '%']];

export function mountHardwareStatus(slot) {
  slot.innerHTML = `
    <button id="hardware-button" type="button" data-state="checking" aria-haspopup="dialog" aria-controls="hardware-dialog">
      <span class="hardware-dot" aria-hidden="true"></span>
      Hardware Status <span id="hardware-count">Checking…</span>
    </button>`;
  const dialog = document.createElement('dialog');
  dialog.id = 'hardware-dialog';
  dialog.innerHTML = `
    <div class="dialog-heading">
      <div><h2>Hardware Status</h2><p class="hardware-note">Live ROS checks</p></div>
      <button type="button" id="hardware-close" aria-label="Close">×</button>
    </div>
    <div class="hardware-layout">
      <section class="hardware-devices"><h3>Device Status</h3><div id="hardware-list"></div></section>
      <section class="hardware-telemetry"><h3>Telemetry</h3><div id="hardware-metrics"></div></section>
    </div>
    <p class="hardware-note">Node availability does not guarantee sensor data or physical operation.</p>`;
  document.body.append(dialog);

  const button = $('hardware-button'), count = $('hardware-count');
  const rows = new Map();
  for (const [id, name] of DEVICES) {
    const row = document.createElement('label');
    row.className = 'hardware-row';
    row.dataset.state = 'checking';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.disabled = true;
    check.setAttribute('aria-label', name);
    const text = document.createElement('span'), title = document.createElement('strong'), detail = document.createElement('small');
    title.textContent = name;
    detail.textContent = 'Checking…';
    text.append(title, detail);
    row.append(check, text);
    $('hardware-list').append(row);
    rows.set(id, { row, check, detail });
  }
  const metrics = new Map();
  for (const [id, name, unit] of READINGS) {
    const row = document.createElement('label');
    row.className = 'hardware-metric';
    row.dataset.state = 'checking';
    const text = document.createElement('span'), title = document.createElement('strong');
    const value = document.createElement('b'), detail = document.createElement('small');
    title.textContent = name;
    value.className = 'hardware-metric-value';
    value.textContent = '—';
    detail.textContent = 'Checking…';
    text.append(title, value, detail);
    row.append(text);
    $('hardware-metrics').append(row);
    metrics.set(id, { row, value, detail, unit });
  }

  function render(data, failure) {
    const find = id => data?.items?.find(x => x.id === id);
    let ready = 0;
    for (const [id, c] of rows) {
      const item = find(id), ok = !failure && item?.ok === true;
      c.check.checked = ok;
      c.row.dataset.state = ok ? 'ready' : 'error';
      c.detail.textContent = failure || item?.detail || 'Status unavailable';
      if (ok) ready++;
    }
    for (const [id, c] of metrics) {
      const item = find(id), ok = !failure && item?.ok === true, available = !failure && Number.isFinite(item?.value);
      c.row.dataset.state = ok ? 'ready' : 'error';
      c.value.textContent = available ? `${item.value} ${c.unit}` : '—';
      c.detail.textContent = failure || item?.detail || 'No data';
    }
    button.dataset.state = ready === rows.size ? 'ready' : 'error';
    count.textContent = `${ready}/${rows.size}`;
  }

  let busy = false;
  async function refresh() {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/api/hardware/status', {
        cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(4000),
      });
      if (response.status === 401) { location.replace('/login'); throw Error('Session expired'); }
      if (!response.ok) throw Error('Hardware status unavailable');
      const data = await response.json();
      if (!Array.isArray(data.items)) throw Error('Invalid status response');
      render(data);
    } catch {
      render(null, navigator.onLine ? 'Status unavailable' : 'Connection lost');
    } finally {
      busy = false;
    }
  }

  button.addEventListener('click', () => { dialog.showModal(); refresh(); });
  $('hardware-close').addEventListener('click', () => { dialog.close(); button.focus(); });
  closeOnBackdrop(dialog);
  window.addEventListener('offline', () => render(null, 'Connection lost'));
  window.addEventListener('online', refresh);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
  setInterval(refresh, 3000);
}
