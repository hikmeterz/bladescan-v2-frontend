import { $ } from '../lib/dom.js';
import { api } from '../lib/api.js';

// Finish, Cancel and Take photo. A command whose outcome is unknown is never
// resent automatically; the session poll resolves it.
export function mountCommands({ session, teleop, refresh }) {
  async function command(kind) {
    refresh();
    if ($(kind + '-button').disabled) return;
    const s = session, before = s.current()?.request_id || null;
    s.pending = true;
    s.revision++;
    if (kind === 'finish') s.finishRequestId = before;
    if (kind === 'cancel') s.cancelRequestId = before;
    teleop.stop();
    s.notice = kind === 'finish' ? 'Finishing inspection…' : 'Sending request…';
    refresh();
    try {
      const result = kind === 'finish' ? await api.finishInspection(before) : await api.cancelInspection(before);
      if (!result?.inspection?.state)
        throw Object.assign(new Error('Operation response could not be verified.'), { outcomeUnknown: true });
      s.accept(result.inspection);
      s.notice = '';
    } catch (error) {
      if (kind === 'finish' && !error.outcomeUnknown) s.finishRequestId = null;
      if (kind === 'cancel' && !error.outcomeUnknown) s.cancelRequestId = null;
      s.notice = error.message;
      if (error.outcomeUnknown) {
        s.uncertain = { kind, before };
        s.notice += ' The command will not be sent again until its outcome is verified.';
      }
    } finally {
      s.pending = false;
      s.revision++;
      refresh();
    }
  }

  async function photo() {
    refresh();
    if ($('photo-button').disabled) return;
    const s = session;
    const photoId = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
    const id = s.current()?.request_id;
    s.photoPending = true;
    s.photoWaitId = photoId;
    s.revision++;
    teleop.stop();
    s.notice = 'Requesting photo…';
    refresh();
    try {
      const result = await api.capturePhoto(id, photoId);
      s.accept(result.inspection);
      s.notice = '';
    } catch (e) {
      s.notice = e.message;
      if (!e.outcomeUnknown) s.photoWaitId = null;
      else s.notice += ' Photo will not be retried automatically. Finish remains available.';
    } finally {
      s.photoPending = false;
      s.revision++;
      refresh();
    }
  }

  $('finish-button').addEventListener('click', () => command('finish'));
  $('cancel-button').addEventListener('click', () => command('cancel'));
  $('photo-button').addEventListener('click', photo);
}
