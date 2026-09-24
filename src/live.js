import { api } from './services/api.js';

const ui = Object.fromEntries([
  'backend-status',
  'linear-speed',
  'angular-speed',
  'distance-value',
  'distance-label',
  'inspection-state',
  'inspection-message',
].map(id => [id, document.getElementById(id)]));

const terminalStates = new Set([
  'succeeded', 'canceled', 'aborted', 'not_sent',
]);

const names = {
  submitted: 'Request submitted',
  running: 'In progress',
  finalizing: 'Finalizing recording',
  succeeded: 'Completed',
  canceled: 'Canceled',
  aborted: 'Failed',
  not_sent: 'Not sent',
  unknown: 'Outcome unknown',
};

let robot = null;
let inspection = null;
let feedbackKey = null;
let feedbackSeenAt = 0;
let pollTimer;
let watchTimer = null;
let generation = 0;

function setText(id, value) {
  if (ui[id]) ui[id].textContent = value;
}

function number(value) {
  return Number.isFinite(value)
    ? value.toLocaleString('en-GB', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : '—';
}

function render() {
  const now = performance.now();
  const robotApiFresh = robot && now - robot.at < 3000;
  const inspectionApiFresh = inspection && now - inspection.at < 3000;
  const data = robotApiFresh ? robot.data : null;

  setText('backend-status',
    data
      ? (
          data.rosbridgeConnected
            ? 'Backend / ROS connected'
            : 'Backend connected / Waiting for ROS'
        )
      : (
          inspectionApiFresh
            ? 'Robot data unavailable'
            : 'Backend disconnected'
        ),
  );

  // Backend'in bildirdigi veri yasina istek suresi de eklenir.
  const odomFresh = data &&
    data.rosbridgeConnected === true &&
    data.stale === false &&
    Number.isFinite(data.ageMs) &&
    data.ageMs >= 0 &&
    now - robot.startedAt + data.ageMs < 2000;

  setText(
    'linear-speed',
    odomFresh ? number(data.odometry?.linearX) : '—',
  );
  setText(
    'angular-speed',
    odomFresh ? number(data.odometry?.angularZ) : '—',
  );

  const current = inspectionApiFresh ? inspection.data.inspection : null;
  const terminal = current && terminalStates.has(current.state);

  const feedbackFresh = current &&
    Number.isFinite(current.last_feedback_at) &&
    now - feedbackSeenAt < 3000;

  setText(
    'distance-label',
    terminal ? 'Son inspection yolu' : 'Inspection distance',
  );

  setText('distance-value',
    current && (
      terminal || (
        current.state !== 'unknown' &&
        feedbackFresh &&
        inspection.data.active === true
      )
    ) ? number(current.distance_m) : '—',
  );

  if (!inspectionApiFresh) {
    setText('inspection-state', 'Bilinmiyor');
    setText('inspection-message', 'Inspection status unavailable.');
  } else if (!current) {
    setText('inspection-state', 'Inspection yok');
    setText(
      'inspection-message',
      'No active inspection. Controls are unavailable.',
    );
  } else {
    setText('inspection-state', names[current.state] ?? 'Bilinmiyor');

    setText('inspection-message',
      !terminal && !feedbackFresh && current.state !== 'submitted'
        ? 'Inspection feedback is stale; the outcome needs verification.'
        : (current.message || 'Inspection status received.'),
    );
  }
}

async function poll(epoch) {
  const startedAt = performance.now();

  const results = await Promise.allSettled([
    api.getRobotState(),
    api.getCurrentInspection(),
  ]);

  if (epoch !== generation) return;

  const now = performance.now();

  robot = results[0].status === 'fulfilled'
    ? { data: results[0].value, at: now, startedAt }
    : null;

  inspection = results[1].status === 'fulfilled'
    ? { data: results[1].value, at: now }
    : null;

  const current = inspection?.data.inspection;
  const key = current
    ? current.request_id + ':' + current.last_feedback_at
    : null;

  if (key !== feedbackKey) {
    feedbackKey = key;
    feedbackSeenAt = now;
  }

  render();
  pollTimer = setTimeout(() => poll(epoch), 500);
}

function start() {
  if (watchTimer !== null) return;

  const epoch = ++generation;
  watchTimer = setInterval(render, 250);
  poll(epoch);
}

window.addEventListener('pagehide', () => {
  generation += 1;
  clearTimeout(pollTimer);
  clearInterval(watchTimer);
  watchTimer = null;
  robot = null;
  inspection = null;
});

window.addEventListener('pageshow', start);
start();
