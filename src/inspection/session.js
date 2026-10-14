import { api } from '../lib/api.js';

// Live state of the inspection screen. Polls robot, inspection and camera
// status every 500 ms and fires a 'poll' event after each round. Command
// flags (pending, uncertain, photo, finish/cancel) live here too, so every
// module reads one consistent picture.
export const TERMINAL = new Set(['succeeded', 'canceled', 'aborted', 'not_sent']);
const PHOTO_DONE = new Set(['completed', 'rejected', 'failed', 'skipped']);
const FRESH_MS = 3000;

async function cameraState() {
  const response = await fetch('/api/camera/state', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
  const result = await response.json();
  if (response.status === 401) location.replace('/login');
  if (!response.ok) throw new Error(result.error || 'Could not retrieve camera status.');
  return result;
}

export class InspectionSession extends EventTarget {
  constructor({ user, pollMs = 500 }) {
    super();
    this.user = user;
    this.pollMs = pollMs;
    this.robot = null; this.inspection = null; this.camera = null;
    this.robotAt = 0; this.inspectionAt = 0; this.cameraAt = 0;
    // Command state shared by the buttons, teleop and the view.
    this.pending = false;          // a finish/cancel request is in flight
    this.uncertain = null;         // { kind, before } when a command outcome is unknown
    this.notice = '';
    this.revision = 0;             // bumps whenever a command changes local state
    this.photoPending = false;
    this.photoWaitId = null;
    this.finishRequestId = null;
    this.cancelRequestId = null;
    this.alive = true;
    this.timer = null;
  }

  fresh(at) { return at > 0 && performance.now() - at < FRESH_MS; }
  current() { return this.inspection?.inspection; }
  active() { return this.inspection?.active === true; }
  inspectionFresh() { return this.fresh(this.inspectionAt); }
  cameraFresh() { return this.fresh(this.cameraAt); }
  robotFresh() { return this.fresh(this.robotAt); }

  photoCommandBusy() {
    const p = this.current()?.photo_command;
    return !!p && !PHOTO_DONE.has(p.status);
  }

  finishRequested(c = this.current()) {
    return !!c && (this.finishRequestId === c.request_id || c.control?.kind === 'finish');
  }

  // Store an inspection snapshot returned by a command.
  accept(snapshot) {
    this.inspection = { inspection: snapshot, active: !TERMINAL.has(snapshot.state) };
    this.inspectionAt = performance.now();
  }

  // True once a finish (with a verified, finalised video) or a cancel has completed.
  readyToLeave() {
    const c = this.current(), camera = this.camera;
    if (!this.alive || this.pending || !this.inspectionFresh() || !this.cameraFresh()
        || !c || this.inspection?.active !== false || !c.inspection_id) return false;
    const finished = this.finishRequested(c) && c.state === 'succeeded'
      && camera?.inspection_id === c.inspection_id && camera.state === 'completed'
      && camera.recording === false && camera.finalized === true && camera.quick_checked === true
      && !camera.error && !!camera.video_path && camera.partial_path == null;
    const canceled = (this.cancelRequestId === c.request_id || c.control?.kind === 'cancel')
      && c.state === 'canceled' && camera?.recording === false
      && (!camera.inspection_id || camera.inspection_id === c.inspection_id);
    return finished || canceled;
  }

  start() { this.poll(); }

  stop() {
    this.alive = false;
    this.revision++;
    clearTimeout(this.timer);
  }

  async poll() {
    const epoch = this.revision, started = performance.now();
    const [robot, inspection, camera] = await Promise.allSettled([
      api.getRobotState(), api.getCurrentInspection(), cameraState(),
    ]);
    if (!this.alive) return;

    // Results that raced with a local command are discarded.
    if (epoch === this.revision) {
      this.robot = robot.status === 'fulfilled' ? robot.value : null;
      this.robotAt = this.robot ? started : 0;
      if (inspection.status === 'fulfilled') {
        this.inspection = inspection.value;
        this.inspectionAt = started;
        this.resolveUncertain();
      } else {
        this.inspectionAt = 0;
      }
      this.camera = camera.status === 'fulfilled' ? camera.value : null;
      this.cameraAt = this.camera ? started : 0;
      this.followPhoto();
    }
    this.dispatchEvent(new Event('poll'));
    this.timer = setTimeout(() => this.poll(), this.pollMs);
  }

  // An uncertain command is resolved once the server shows its effect.
  resolveUncertain() {
    const c = this.current(), u = this.uncertain;
    if (!u || !c) return;
    const resolved = u.kind === 'start'
      ? c.request_id !== u.before
      : c.request_id === u.before && (!!c.control || TERMINAL.has(c.state));
    if (resolved) { this.uncertain = null; this.notice = ''; }
  }

  followPhoto() {
    const photo = this.camera?.photo;
    if (this.photoWaitId && this.camera?.inspection_id === this.current()?.inspection_id
        && photo?.request_id === this.photoWaitId && PHOTO_DONE.has(photo.state)) {
      this.photoWaitId = null;
      this.notice = photo.message || '';
    }
  }
}
