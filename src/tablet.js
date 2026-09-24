import { api } from './services/api.js';
const signedIn = await api.me();

const $ = id => document.getElementById(id);
const dialog = $('inspection-dialog');
const form = $('inspection-form');
const terminal = new Set(['succeeded', 'canceled', 'aborted', 'not_sent']);

const labels = {
  submitted: 'Preparing', running: 'In progress',
  finalizing: 'Finalizing recording', succeeded: 'Completed',
  canceled: 'Canceled', aborted: 'Failed',
  unknown: 'Outcome unknown', not_sent: 'Not sent',
};
const cameraLabels = {
  idle: 'Waiting for inspection', preparing: 'Preparing camera',
  recording: 'Recording video', finalizing: 'Finalizing video',
  completed: 'Video saved', error: 'Camera error',
};

let finishRequestId = null;
let redirecting = false;
let draft = null;
let robot = null, inspection = null, camera = null;
let robotAt = 0, inspectionAt = 0, cameraAt = 0;
let pending = false, uncertain = null, notice = '', revision = 0;
let alive = true, pollTimer, frameTimer, renderTimer;
let frameController = null, frameUrl = null, frameSeen = 0;

const current = () => inspection?.inspection;
const active = () => inspection?.active === true;
const fresh = at => at > 0 && performance.now() - at < 3000;
const number = value => Number.isFinite(value)
  ? value.toLocaleString('en-GB', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    })
  : '—';

function odomReady() {
  return fresh(robotAt) && robot?.rosbridgeConnected
    && robot.odometry && !robot.stale && Number.isFinite(robot.ageMs)
    && robot.ageMs + performance.now() - robotAt < 2000;
}

function hideFrame() {
  $('camera-feed').hidden = true;
  $('camera-empty').hidden = false;
  $('camera-feed').removeAttribute('src');
  if (frameUrl) URL.revokeObjectURL(frameUrl);
  frameUrl = null;
  frameSeen = 0;
}

function finishRequested(c = current()) {
  return !!c && (
    finishRequestId === c.request_id || c.control?.kind === 'finish'
  );
}

function maybeReturnToDashboard() {
  const c = current();
  if (redirecting || !alive || pending
      || !fresh(inspectionAt) || !fresh(cameraAt)
      || !finishRequested(c) || inspection?.active !== false
      || c.state !== 'succeeded' || !c.inspection_id
      || camera?.inspection_id !== c.inspection_id
      || camera.state !== 'completed' || camera.recording !== false
      || camera.finalized !== true || camera.quick_checked !== true || camera.error || !camera.video_path
      || camera.partial_path != null) return;

  redirecting = true;
  stopRobot();
  location.replace('/dashboard');
}

function render() {
  const stateFresh = fresh(inspectionAt);
  const camFresh = fresh(cameraAt);
  const c = current();

  if (stateFresh && c?.request && (active() || !draft)) {
    const r = c.request;
    $('inspection-summary').textContent =
      `${r.plant} / ${r.turbine} / Blade ${r.blade} / Section ${r.section}`;
  }

  $('backend-status').textContent = fresh(robotAt)
    ? (robot?.rosbridgeConnected ? 'Backend / ROS connected' : 'ROS disconnected')
    : 'Backend data is stale';
  $('linear-speed').textContent =
    odomReady() ? number(robot.odometry.linearX) : '—';
  $('angular-speed').textContent =
    odomReady() ? number(robot.odometry.angularZ) : '—';
  $('distance-label').textContent =
    c && terminal.has(c.state) ? 'Son inspection yolu' : 'Inspection distance';
  $('distance-value').textContent =
    stateFresh && c && c.state !== 'unknown' ? number(c.distance_m) : '—';
  $('inspection-state').textContent =
    !stateFresh ? 'Bilinmiyor' : labels[c?.state] || 'Inspection yok';
  $('inspection-message').textContent = notice
    || (!stateFresh ? 'Inspection status unavailable.'
      : c?.message || 'Enter the details to start an inspection.');

  if (stateFresh && finishRequested(c) && active()
      && c.state !== 'unknown' && !uncertain && !notice) {
    $('inspection-message').textContent =
      'Finishing inspection… Finalizing and checking the video.';
  }

  const cameraBusy =
    ['preparing', 'recording', 'finalizing'].includes(camera?.state);
  $('start-button').disabled = pending || !!uncertain || !draft
    || !stateFresh || active() || !odomReady() || !camFresh || cameraBusy;

  const controlReady = !pending && !uncertain && stateFresh && active()
    && c?.state !== 'unknown' && !c?.control
    && fresh(robotAt) && robot?.rosbridgeConnected;
  $('finish-button').disabled =
    !controlReady || !['recording', 'traversing'].includes(c?.stage);
  $('cancel-button').disabled =
    !controlReady || !['preparing', 'recording', 'traversing'].includes(c?.stage);
  $('details-button').disabled = pending || !!uncertain || !stateFresh || active();

  $('camera-status').textContent = camFresh
    ? cameraLabels[camera?.state] || 'Bilinmiyor'
    : 'Camera status unavailable';
  $('stream-status').textContent = camFresh
    ? camera?.error || (camera?.finalized
      ? 'Preview ready (quick check): ' + camera.video_path
      : camera?.recording ? 'Recording MP4 on Jetson' : 'Stream inactive')
    : 'Waiting for camera connection';

  if (!camFresh || !camera?.preview_ready || camera.state !== 'recording'
      || (frameSeen && performance.now() - frameSeen > 2000)) {
    hideFrame();
  }
}

async function cameraState() {
  const response = await fetch('/api/camera/state', {
    cache: 'no-store', signal: AbortSignal.timeout(2500),
  });
  const result = await response.json();
  if (response.status === 401) location.replace('/login');
  if (!response.ok) throw new Error(result.error || 'Could not retrieve camera status.');
  return result;
}

async function poll() {
  const epoch = revision;
  const started = performance.now();
  const results = await Promise.allSettled([
    api.getRobotState(), api.getCurrentInspection(), cameraState(),
  ]);
  if (!alive) return;

  if (epoch === revision) {
    robot = results[0].status === 'fulfilled' ? results[0].value : null;
    robotAt = robot ? started : 0;

    if (results[1].status === 'fulfilled') {
      inspection = results[1].value;
      inspectionAt = started;
      const c = current();
      if (uncertain && c && (uncertain.kind === 'start'
          ? c.request_id !== uncertain.before
          : c.request_id === uncertain.before
            && (!!c.control || terminal.has(c.state)))) {
        uncertain = null;
        notice = '';
      }
    } else {
      inspectionAt = 0;
    }

    camera = results[2].status === 'fulfilled' ? results[2].value : null;
    cameraAt = camera ? started : 0;
  }

  render();
  setTeleopUi();
  maybeReturnToDashboard();
  pollTimer = setTimeout(poll, 500);
}

function frameAllowed(id, epoch) {
  return alive && epoch === revision && fresh(cameraAt)
    && camera?.inspection_id === id
    && camera.preview_ready && camera.state === 'recording';
}

async function frames() {
  const id = fresh(cameraAt) && camera?.preview_ready
    ? camera.inspection_id : null;

  if (id) {
    const epoch = revision;
    const controller = new AbortController();
    frameController = controller;
    const timer = setTimeout(() => controller.abort(), 1500);

    try {
      const response = await fetch(
        '/api/camera/frame.jpg?inspection_id=' + encodeURIComponent(id),
        { cache: 'no-store', signal: controller.signal },
      );
      if (!response.ok) throw new Error('Could not retrieve the image.');
      const blob = await response.blob();

      if (frameAllowed(id, epoch)) {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.src = url;
        try {
          await image.decode();
        } catch (error) {
          URL.revokeObjectURL(url);
          throw error;
        }

        if (!frameAllowed(id, epoch)) {
          URL.revokeObjectURL(url);
        } else {
          const previous = frameUrl;
          frameUrl = url;
          frameSeen = performance.now();
          $('camera-feed').src = url;
          $('camera-feed').hidden = false;
          $('camera-empty').hidden = true;
          if (previous) URL.revokeObjectURL(previous);
        }
      }
    } catch {
      if (!frameSeen || performance.now() - frameSeen > 2000) hideFrame();
    } finally {
      clearTimeout(timer);
      frameController = null;
    }
  }

  if (alive) frameTimer = setTimeout(frames, 100);
}

async function command(kind) {
  render();
  if ($(kind + '-button').disabled) return;

  const before = current()?.request_id || null;
  pending = true;
  revision++;
  if (kind === 'finish') finishRequestId = before;
  if (kind !== 'start') stopRobot();
  setTeleopUi();
  notice = kind === 'finish'
    ? 'Finishing inspection…' : 'Sending request…';
  render();

  try {
    const result = kind === 'start'
      ? await api.startInspection(draft)
      : kind === 'finish'
        ? await api.finishInspection(before)
        : await api.cancelInspection(before);

    if (!result?.inspection?.state) {
      throw Object.assign(new Error('Operation response could not be verified.'), {
        outcomeUnknown: true,
      });
    }

    inspection = {
      inspection: result.inspection,
      active: !terminal.has(result.inspection.state),
    };
    inspectionAt = performance.now();
    notice = '';
  } catch (error) {
    if (kind === 'finish' && !error.outcomeUnknown) finishRequestId = null;
    notice = error.message;
    if (error.outcomeUnknown) {
      uncertain = { kind, before };
      notice += ' The command will not be sent again until its outcome is verified.';
    }
  } finally {
    pending = false;
    revision++;
    render();
    setTeleopUi();
  }
}

for (const kind of ['start', 'finish', 'cancel']) {
  $(kind + '-button').addEventListener('click', () => command(kind));
}

$('details-button').addEventListener('click', () => {
  form.reset();
  if (draft) {
    for (const [key, value] of Object.entries(draft)) {
      form.elements.namedItem(key).value = value;
    }
  }
  dialog.showModal();
});

for (const id of ['dialog-close', 'dialog-cancel']) {
  $(id).addEventListener('click', () => dialog.close());
}

form.addEventListener('input', event => {
  event.target.setCustomValidity?.('');
});

form.addEventListener('submit', event => {
  event.preventDefault();
  const values = Object.fromEntries(
    [...new FormData(form)].map(([key, value]) => [key, value.trim()]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (!value || /[\u0000-\u001f\u007f]/.test(value)) {
      form.elements.namedItem(key).setCustomValidity('Enter a valid value.');
      form.reportValidity();
      return;
    }
  }

  draft = values;
  $('inspection-summary').textContent =
    `${values.plant} / ${values.turbine} / Blade ${values.blade} / Section ${values.section}`;
  $('ui-message').textContent =
    'Details ready. Press Start to begin camera and ROS recording.';
  dialog.close();
  render();
});

$('fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('console').requestFullscreen();
  } catch {
    $('ui-message').textContent = 'Could not enter fullscreen.';
  }
});

document.addEventListener('fullscreenchange', () => {
  const enabled = document.fullscreenElement === $('console');
  $('fullscreen-button').textContent = enabled ? 'Exit fullscreen' : 'Fullscreen';
  $('fullscreen-button').setAttribute('aria-pressed', String(enabled));
});

window.addEventListener('pagehide', () => {
  alive = false;
  revision++;
  clearTimeout(pollTimer);
  clearTimeout(frameTimer);
  clearInterval(renderTimer);
  frameController?.abort();
  hideFrame();
});

window.addEventListener('pageshow', event => {
  if (event.persisted) location.reload();
});

$('ui-message').textContent = 'Waiting for inspection and camera connection.';
renderTimer = setInterval(render, 250);
render();
poll();
frames();


// -----------------------------------------------------------------------------
// ROS TELEOP
// UI -> rosbridge WebSocket -> /cmd_vel -> robot hardware
// -----------------------------------------------------------------------------

const TELEOP_LINEAR_SPEED = 0.20;
const TELEOP_ANGULAR_SPEED = 1.0;
const TELEOP_RATE_MS = 100;

const driveButtons = {
  forward: document.querySelector('.drive-button.forward'),
  backward: document.querySelector('.drive-button.backward'),
  left: document.querySelector('.drive-button.left'),
  right: document.querySelector('.drive-button.right'),
  stop: document.querySelector('.drive-button.stop'),
};

const drivePanel = document.querySelector('.drive-panel');
const driveBadge = drivePanel?.querySelector('.badge');
const driveHint = drivePanel?.querySelector('.hint');

let teleopSocket = null;
let teleopConnected = false;
let teleopTimer = null;
let teleopReconnectTimer = null;
let activeDriveCommand = null;

function teleopInspectionReady() {
  return teleopConnected
    && fresh(inspectionAt)
    && active()
    && signedIn.user.role !== 'viewer'
    && !pending && !uncertain
    && !finishRequested() && !current()?.control
    && ['recording', 'traversing'].includes(current()?.stage)
    && current()?.state !== 'unknown'
    && fresh(cameraAt)
    && camera?.state === 'recording';
}

function setTeleopUi() {
  const enabled = teleopInspectionReady();

  if (!enabled && activeDriveCommand) {
    stopRobot();
  }

  for (const button of Object.values(driveButtons)) {
    if (button) button.disabled = !enabled;
  }

  if (driveBadge) {
    driveBadge.textContent = enabled ? 'Aktif' : 'Pasif';
  }

  if (driveHint) {
    if (!teleopConnected) {
      driveHint.textContent =
        'ROS drive control is disconnected. Buttons will not send commands.';
    } else if (!active()) {
      driveHint.textContent =
        'Start an inspection to enable manual driving.';
    } else if (camera?.state !== 'recording') {
      driveHint.textContent =
        'Waiting for camera recording to start.';
    } else {
      driveHint.textContent =
        'Inspection active. Manual driving is ready.';
    }
  }
}

function sendTwist(linearX, angularZ) {
  if (
    !teleopConnected ||
    !teleopSocket ||
    teleopSocket.readyState !== WebSocket.OPEN
  ) {
    return;
  }

  teleopSocket.send(JSON.stringify({
    op: 'publish',
    topic: '/cmd_vel',
    msg: {
      linear: {
        x: linearX,
        y: 0.0,
        z: 0.0,
      },
      angular: {
        x: 0.0,
        y: 0.0,
        z: angularZ,
      },
    },
  }));
}

function stopRobot() {
  clearInterval(teleopTimer);
  teleopTimer = null;
  activeDriveCommand = null;

  sendTwist(0.0, 0.0);
}

function startDrive(linearX, angularZ) {
  if (!teleopInspectionReady()) return;

  clearInterval(teleopTimer);

  activeDriveCommand = { linearX, angularZ };

  // İlk komutu beklemeden gönder.
  sendTwist(linearX, angularZ);

  // Butona basılı tutulduğu sürece 10 Hz yayınla.
  teleopTimer = setInterval(() => {
    if (!teleopInspectionReady()) { stopRobot(); return; }
    if (!activeDriveCommand) return;

    sendTwist(
      activeDriveCommand.linearX,
      activeDriveCommand.angularZ,
    );
  }, TELEOP_RATE_MS);
}

function connectTeleopRosbridge() {
  clearTimeout(teleopReconnectTimer);

  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${protocol}://${location.host}/api/teleop`;

  console.log('[TELEOP] Rosbridge bağlantısı:', url);

  const ws = new WebSocket(url);
  teleopSocket = ws;

  ws.addEventListener('open', () => {
    if (teleopSocket !== ws) return;

    console.log('[TELEOP] Rosbridge bağlantısı kuruldu.');

    teleopConnected = true;

    ws.send(JSON.stringify({
      op: 'advertise',
      topic: '/cmd_vel',
      type: 'geometry_msgs/msg/Twist',
    }));

    setTeleopUi();

    // Bağlantı açıldığında önce güvenli STOP.
    sendTwist(0.0, 0.0);
  });

  ws.addEventListener('error', error => {
    console.error('[TELEOP] Rosbridge WebSocket hatası:', error);
  });

  ws.addEventListener('close', () => {
    if (teleopSocket !== ws) return;

    console.warn('[TELEOP] Rosbridge bağlantısı kapandı.');

    clearInterval(teleopTimer);
    teleopTimer = null;
    activeDriveCommand = null;

    teleopConnected = false;
    teleopSocket = null;
    setTeleopUi();

    if (alive) {
      teleopReconnectTimer = setTimeout(connectTeleopRosbridge, 2000);
    }
  });
}

function bindDriveButton(button, linearX, angularZ) {
  if (!button) return;

  button.addEventListener('pointerdown', event => {
    if (button.disabled) return;

    event.preventDefault();

    try {
      button.setPointerCapture(event.pointerId);
    } catch {}

    startDrive(linearX, angularZ);
  });

  button.addEventListener('pointerup', event => {
    event.preventDefault();
    stopRobot();
  });

  button.addEventListener('pointercancel', stopRobot);
  button.addEventListener('lostpointercapture', stopRobot);
}

bindDriveButton(
  driveButtons.forward,
  TELEOP_LINEAR_SPEED,
  0.0,
);

bindDriveButton(
  driveButtons.backward,
  -TELEOP_LINEAR_SPEED,
  0.0,
);

bindDriveButton(
  driveButtons.left,
  0.0,
  TELEOP_ANGULAR_SPEED,
);

bindDriveButton(
  driveButtons.right,
  0.0,
  -TELEOP_ANGULAR_SPEED,
);

driveButtons.stop?.addEventListener('pointerdown', event => {
  event.preventDefault();
  stopRobot();
});

// Mouse/touch beklenmedik şekilde bırakılırsa robotu durdur.
window.addEventListener('pointerup', stopRobot);
window.addEventListener('pointercancel', stopRobot);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopRobot();
});

window.addEventListener('blur', stopRobot);

window.addEventListener('pagehide', () => {
  clearTimeout(teleopReconnectTimer);
  stopRobot();

  try {
    teleopSocket?.close();
  } catch {}
});

setTeleopUi();
connectTeleopRosbridge();
