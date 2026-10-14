import { $ } from '../lib/dom.js';
import { TERMINAL } from './session.js';

// Text, button states and the "Inspection information" dialog.
const LABELS = {
  submitted: 'Preparing', running: 'In progress', finalizing: 'Finalizing recording', succeeded: 'Completed',
  canceled: 'Canceled', aborted: 'Failed', unknown: 'Outcome unknown', not_sent: 'Not sent',
};
const CAMERA_LABELS = {
  idle: 'Waiting for inspection', preparing: 'Preparing camera', recording: 'Recording video',
  finalizing: 'Finalizing video', completed: 'Video saved', error: 'Camera error',
  interrupting: 'Taking photo / resuming video',
};
const number = value => (Number.isFinite(value)
  ? value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');

export function createView({ session, dialog, preview }) {
  function message(c) {
    const s = session, camera = s.camera;
    if (s.notice) return s.notice;
    if (s.cameraFresh() && camera?.photo_busy && camera.photo?.message) return camera.photo.message;
    if (!s.inspectionFresh()) return 'Inspection status unavailable.';
    if (s.finishRequested(c) && s.active()) return 'Finishing inspection… Finalizing and checking video.';
    if (c?.state === 'unknown') return 'Outcome unknown. Check inspection information.';
    if (c?.state === 'aborted') return c.message || 'Inspection failed.';
    if (s.active()) return 'Hold joystick to drive · Release to stop';
    if (c && TERMINAL.has(c.state)) return 'Inspection ended. Open inspection info to return to dashboard.';
    return 'Open inspection info to return to dashboard.';
  }

  function renderInformation() {
    const c = session.current(), r = c?.request || {};
    const values = [
      ['Plant', r.plant], ['Turbine', r.turbine], ['Blade', r.blade], ['Section', r.section],
      ['Operator', r.operator_name || session.user.display_name], ['State', LABELS[c?.state] || 'Unavailable'],
      ['Distance', session.inspectionFresh() && Number.isFinite(c?.distance_m) ? number(c.distance_m) + ' m' : '—'],
      ['Started', c?.created_at ? new Date(c.created_at).toLocaleString('en-GB') : '—'],
      ['Inspection ID', c?.inspection_id],
    ];
    $('inspection-information').replaceChildren(...values.map(([label, value]) => {
      const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
      if (label === 'Inspection ID') row.className = 'wide';
      dt.textContent = label;
      dd.textContent = value || '—';
      row.append(dt, dd);
      return row;
    }));
    $('dialog-message').textContent = session.notice
      || (!session.inspectionFresh() ? 'Inspection information is stale.' : c?.message || '');
  }

  function render() {
    const s = session, c = s.current(), camera = s.camera, camFresh = s.cameraFresh();
    $('distance-label').textContent = c && TERMINAL.has(c.state) ? 'Final distance' : 'Distance';
    $('distance-value').textContent = s.inspectionFresh() && c && c.state !== 'unknown' ? number(c.distance_m) : '—';
    $('inspection-state').textContent = !s.inspectionFresh() ? 'Unavailable' : LABELS[c?.state] || 'No inspection';
    $('inspection-message').textContent = message(c);

    const controlReady = !s.pending && !s.uncertain && s.inspectionFresh() && s.active() && c?.state !== 'unknown'
      && !c?.control && s.robotFresh() && s.robot?.rosbridgeConnected;
    $('finish-button').disabled = !controlReady || !['recording', 'traversing'].includes(c?.stage);
    $('cancel-button').disabled = !controlReady || !['preparing', 'recording', 'traversing'].includes(c?.stage);
    $('photo-button').disabled = !controlReady || s.user.role === 'viewer' || s.photoPending || !!s.photoWaitId
      || !camFresh || camera?.state !== 'recording' || camera?.recording !== true || camera?.photo_busy || s.photoCommandBusy();
    $('photo-button').textContent = s.photoPending || camera?.photo_busy ? 'Taking photo…' : 'Take photo';
    $('camera-status').textContent = preview.source() === 'webcam' ? 'Connecting to webcam…'
      : camFresh ? CAMERA_LABELS[camera?.state] || 'Waiting for camera' : 'Camera status unavailable';
    preview.check();
    if (dialog.open) renderInformation();
  }

  return { render, renderInformation };
}
