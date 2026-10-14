import { $ } from '../lib/dom.js';
import { attachJoystick } from './joystick.js';

// Manual driving: joystick -> backend /api/teleop WebSocket -> rosbridge /cmd_vel.
// Commands repeat at 10 Hz while the stick is held; anything unexpected
// (release, blur, hidden page, lost connection, unsafe state) sends a STOP.
const MAX_LINEAR = 0.20;           // m/s at speed level 5
const RATE_MS = 100;
const RECONNECT_MS = 2000;

export function createTeleop({ session, isBlocked }) {
  let socket = null, connected = false, timer = null, reconnectTimer = null, command = null;

  function ready() {
    const s = session, c = s.current(), camera = s.camera;
    return s.alive && !document.hidden && !isBlocked() && connected
      && s.inspectionFresh() && s.active() && s.user.role !== 'viewer'
      && !s.pending && !s.uncertain && !s.photoPending && !s.photoWaitId && !s.photoCommandBusy()
      && !s.finishRequested() && !c?.control
      && ['recording', 'traversing'].includes(c?.stage) && c?.state !== 'unknown'
      && s.cameraFresh() && camera?.state === 'recording' && camera.recording === true && !camera.error
      && camera.inspection_id === c?.inspection_id;
  }

  function sendTwist(linearX, angularZ) {
    if (!connected || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
      op: 'publish', topic: '/cmd_vel',
      msg: { linear: { x: linearX, y: 0, z: 0 }, angular: { x: 0, y: 0, z: angularZ } },
    }));
  }

  function stop() {
    clearInterval(timer);
    timer = null;
    command = null;
    joystick.reset();
    sendTwist(0, 0);
  }

  function drive(linearX, angularZ) {
    if (!ready()) return;
    command = { linearX, angularZ };
    // Pointer movement only updates the vector; publishing stays at 10 Hz.
    if (timer !== null) return;
    sendTwist(linearX, angularZ);
    timer = setInterval(() => {
      if (!ready()) { stop(); syncUi(); return; }
      if (command) sendTwist(command.linearX, command.angularZ);
    }, RATE_MS);
  }

  function syncUi() {
    const enabled = ready();
    if (!enabled && command) stop();
    joystick.setEnabled(enabled);
    $('drive-status').textContent = enabled ? 'Ready' : 'Locked';
  }

  function connect() {
    clearTimeout(reconnectTimer);
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/teleop`;
    console.log('[TELEOP] Connecting to', url);
    const ws = new WebSocket(url);
    socket = ws;
    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      console.log('[TELEOP] Connected.');
      connected = true;
      ws.send(JSON.stringify({ op: 'advertise', topic: '/cmd_vel', type: 'geometry_msgs/msg/Twist' }));
      syncUi();
      sendTwist(0, 0);                           // start from a known STOP
    });
    ws.addEventListener('error', error => {
      console.error('[TELEOP] WebSocket error:', error);
      if (socket !== ws) return;
      stop();
      connected = false;
      syncUi();
      try { ws.close(); } catch {}
    });
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      console.warn('[TELEOP] Connection closed.');
      clearInterval(timer);
      timer = null;
      command = null;
      joystick.reset();
      connected = false;
      socket = null;
      syncUi();
      if (session.alive) reconnectTimer = setTimeout(connect, RECONNECT_MS);
    });
  }

  const speed = $('speed-level');
  const joystick = attachJoystick({ pad: $('drive-stick'), knob: $('drive-knob'), speed,
    onVector: drive, onStop: stop, isReady: ready });
  speed.addEventListener('input', () => {
    const level = Number(speed.value);
    $('speed-value').value = String(level);
    $('speed-limit').textContent = (MAX_LINEAR * level / 5).toFixed(2) + ' m/s';
  });

  // Stop whenever the operator might have lost control of the pointer or page.
  window.addEventListener('pointerup', stop);
  window.addEventListener('pointercancel', stop);
  window.addEventListener('blur', stop);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
  window.addEventListener('pagehide', () => {
    clearTimeout(reconnectTimer);
    stop();
    try { socket?.close(); } catch {}
  });

  return { connect, stop, syncUi };
}
