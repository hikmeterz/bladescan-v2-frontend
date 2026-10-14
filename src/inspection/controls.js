import { $, closeOnBackdrop } from '../lib/dom.js';
import { request } from '../lib/api.js';

// Deck controls outside driving: lights (LED board), camera source, drive mode,
// robot status popup, device summary and the REC timer.
const LED_POLL_MS = 1500, HOLD_MS = 1500;
const CHANNELS = ['a', 'b', 'c', 'd'];
// Board levels: 1..4 brighter, 5 = dimmest. Slider: 0 = Min, 1..4.
const toSlider = level => (level === 5 ? 0 : level);
const toLevel = value => (value === 0 ? 5 : value);
const label = value => (value === 0 ? 'Min' : String(value));

function mountLights(canControl) {
  const sliders = [...document.querySelectorAll('#led-sliders .vslider')].map(el => ({
    channel: el.dataset.channel, input: el.querySelector('input'), output: el.querySelector('output'),
  }));
  let led = null, touchedAt = 0, sendTimer = null;
  const queued = new Map();

  function render() {
    const connected = led?.connected === true;
    const busy = Date.now() - touchedAt < HOLD_MS;   // do not fight the user's finger
    $('led-status').textContent = !led ? 'Connecting…'
      : connected ? (led.error ? 'Check board' : led.pending ? 'Applying…' : 'Board connected') : 'Not connected';
    $('led-status').title = led?.error || '';
    const levels = CHANNELS.map(c => led?.levels?.[c]);
    for (const s of sliders) {
      s.input.disabled = !connected || !canControl;
      if (busy) continue;
      if (s.channel === 'all') {
        const same = levels.every(l => l != null && l === levels[0]);
        if (same) s.input.value = toSlider(levels[0]);
        s.output.textContent = !connected ? '—' : same ? label(toSlider(levels[0])) : 'Mix';
      } else {
        const level = led?.levels?.[s.channel];
        if (level != null) s.input.value = toSlider(level);
        s.output.textContent = connected && level != null ? label(toSlider(level)) : '—';
      }
    }
    $('led-reading').textContent = !connected ? 'Not connected'
      : CHANNELS.map((c, i) => `L${i + 1} ${levels[i] == null ? '—' : label(toSlider(levels[i]))}`).join(' · ');
  }

  async function poll() {
    try { led = (await request('/api/led', { timeoutMs: 2500 })).led; }
    catch { led = led ? { ...led, connected: false, error: 'Backend unavailable' } : null; }
    render();
    setTimeout(poll, LED_POLL_MS);
  }

  function flush() {
    sendTimer = null;
    const jobs = [...queued.entries()];
    queued.clear();
    for (const [channel, level] of jobs) {
      request('/api/led', { method: 'POST', body: { channel, level } })
        .then(result => { led = result.led; })
        .catch(() => {});
    }
  }

  for (const s of sliders) {
    s.input.addEventListener('input', () => {
      touchedAt = Date.now();
      const value = Number(s.input.value);
      s.output.textContent = label(value);
      if (s.channel === 'all') {
        for (const other of sliders) if (other !== s) { other.input.value = value; other.output.textContent = label(value); }
        queued.clear();
      } else {
        queued.delete('all');
      }
      queued.set(s.channel, toLevel(value));
      if (!sendTimer) sendTimer = setTimeout(flush, 150);   // light throttle while dragging
    });
  }
  render();
  poll();
}

// Segmented single-choice control. With a storage key the choice is remembered in this browser.
function radioGroup(group, key, onChange) {
  const buttons = [...group.querySelectorAll('button[role="radio"]')];
  const select = (button, store = true) => {
    if (!button || button.disabled) return;
    for (const b of buttons) { const on = b === button; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    if (store && key) try { localStorage.setItem(key, button.dataset.value); } catch {}
    onChange(button);
  };
  for (const b of buttons) {
    b.dataset.value = b.dataset.camera || b.dataset.mode;
    b.addEventListener('click', () => select(b));
    b.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const enabled = buttons.filter(x => !x.disabled), i = enabled.indexOf(b);
      const next = enabled[(i + (e.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length];
      select(next); next.focus();
    });
  }
  let saved = null;
  if (key) try { saved = localStorage.getItem(key); } catch {}
  select(buttons.find(b => b.dataset.value === saved && !b.disabled)
    || buttons.find(b => b.getAttribute('aria-checked') === 'true'), false);
  return {
    value: () => buttons.find(b => b.getAttribute('aria-checked') === 'true')?.dataset.value,
    select: value => select(buttons.find(b => b.dataset.value === value)),
  };
}

// The Webcam button is enabled while the USB webcam is plugged in. If it is
// unplugged while selected, the view falls back to the Insta360.
function watchWebcam(cameras) {
  const button = $('camera-source').querySelector('[data-camera="webcam"]');
  async function poll() {
    try {
      const { webcam } = await request('/api/webcam/state', { timeoutMs: 2500 });
      button.disabled = !webcam.available;
      button.title = webcam.available ? 'USB webcam' : 'Not connected';
      $('camera-feed').dataset.rotate = String(webcam.rotate || 0);
    } catch {}
    if (button.disabled && cameras.value() === 'webcam') cameras.select('insta360');
    setTimeout(poll, 3000);
  }
  poll();
}

function renderRec(session) {
  const fresh = session.inspectionFresh() && session.cameraFresh();
  const c = session.current(), camera = session.camera;
  const recording = !!(fresh && session.active() && camera?.recording === true && camera.state === 'recording'
    && camera.inspection_id === c?.inspection_id);
  const start = c?.started_at || c?.created_at;
  $('rec-indicator').hidden = !recording;
  if (recording && start) {
    const s = Math.max(0, Math.floor((Date.now() - start) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = s % 60;
    $('rec-time').textContent = (h ? h + ':' + String(m).padStart(2, '0') : String(m).padStart(2, '0')) + ':' + String(sec).padStart(2, '0');
  }
  $('status-dot').dataset.tone = !session.inspectionFresh() ? 'error'
    : ['unknown', 'aborted'].includes(c?.state) ? 'error'
    : recording ? 'ok' : session.active() ? 'warn' : '';
}

export function mountControls(session) {
  mountLights(session.user.role !== 'viewer');

  // Always start on the Insta360: the webcam is an optional driving view.
  const cameras = radioGroup($('camera-source'), null, b => {
    $('camera-source-note').textContent = b.textContent.trim();
    session.dispatchEvent(new CustomEvent('camera-source-change', { detail: b.dataset.value }));
  });
  watchWebcam(cameras);
  radioGroup($('drive-mode'), 'bladescan.driveMode', b => {
    session.dispatchEvent(new CustomEvent('drive-mode-change', { detail: Number(b.dataset.value) }));
  });

  const statusDialog = $('status-dialog');
  $('status-button').addEventListener('click', () => statusDialog.showModal());
  for (const id of ['status-close', 'status-ok']) $(id).addEventListener('click', () => statusDialog.close());
  closeOnBackdrop(statusDialog);

  setInterval(() => {
    const nodes = [...document.querySelectorAll('#hardware-grid input')];
    $('hardware-summary').textContent = nodes.length ? `Devices ${nodes.filter(n => n.checked).length}/${nodes.length}` : 'Devices —';
    renderRec(session);
  }, 500);
}
