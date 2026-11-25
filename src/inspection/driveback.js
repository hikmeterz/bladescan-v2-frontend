import { $, node } from '../lib/dom.js';
import { send as request } from '../lib/api.js';

// Drive back (backend inspection/retrieve.js): after the Insta360 is lost the
// operator can still drive the robot back watching the webcam. Nothing is
// recorded; the backend caps the speed and refuses commands without a live
// webcam picture.
function ensureStyle() {
  if (document.getElementById('driveback-style')) return;
  const style = document.createElement('style');
  style.id = 'driveback-style';
  style.textContent = `
  .driveback-panel{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:50;display:flex;flex-wrap:wrap;
    gap:8px 12px;align-items:center;max-width:min(760px,94vw);padding:10px 14px;border-radius:10px;background:#fff5e3;
    border:1px solid #f3dfb7;color:#795218;font-size:13px;line-height:1.45;box-shadow:0 4px 16px #0003}
  .driveback-panel[data-state=driving]{background:#fdecea;border-color:#f3b8b3;color:#8a1f15}
  .driveback-panel strong{letter-spacing:.04em}
  .driveback-panel span{flex:1 1 280px}
  .driveback-panel button{padding:7px 12px;font-size:12px}
  .driveback-panel .msg{flex-basis:100%;margin:0;color:#b42318}
  .driveback-panel .msg:empty{display:none}
  body.drive-back #photo-button,body.drive-back #finish-button,body.drive-back #cancel-button{display:none}`;
  document.head.append(style);
}

export function mountDriveBack({ session, teleop, preview }) {
  ensureStyle();
  const panel = node('div', undefined, 'driveback-panel');
  const msg = node('p', '', 'msg');
  panel.hidden = true;
  ($('console') || document.body).append(panel);
  let busy = false, shown = '';

  async function call(action) {
    if (busy) return false;
    busy = true;
    teleop.stop();
    msg.textContent = '';
    try { await request('/api/robot/drive-back', { action }); return true; }
    catch (e) { msg.textContent = e.message; return false; }
    finally { busy = false; }
  }

  const button = (text, onClick) => {
    const b = node('button', text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  function render() {
    const r = session.inspection?.retrieve;
    const mine = r?.mine === true;
    document.body.classList.toggle('drive-back', mine);
    if (mine && preview.source() !== 'webcam')
      session.dispatchEvent(new CustomEvent('camera-source-change', { detail: 'webcam' }));

    let state = '';
    if (mine) state = 'driving';
    else if (!session.active() && session.inspectionFresh() && r?.available) state = r.active ? 'busy' : 'offer';
    if (state === shown) return;
    shown = state;
    panel.hidden = !state;
    panel.dataset.state = state;
    if (!state) { panel.replaceChildren(); return; }

    if (state === 'driving') {
      panel.replaceChildren(
        node('strong', 'DRIVE BACK · not recording'),
        node('span', `Webcam view. Speed is limited to ${Math.round((r.max_linear || 0.12) * 100)} cm/s. ` +
          'Bring the robot within reach, stop the recording on the camera, replug its USB cable, ' +
          'then use Unlock & Recover on the dashboard.'),
        button('Exit drive back', async () => { if (await call('stop')) location.assign('/dashboard'); }),
        msg);
    } else if (state === 'busy') {
      panel.replaceChildren(node('strong', 'Camera disconnected'),
        node('span', `${r.driver} is driving the robot back with the webcam.`),
        button('Dashboard', () => location.assign('/dashboard')), msg);
    } else {
      panel.replaceChildren(node('strong', 'Camera disconnected'),
        node('span', 'The recording stopped. You can drive the robot back using the webcam.'),
        button('Drive back with webcam', () => call('start')),
        button('Dashboard', () => location.assign('/dashboard')), msg);
    }
  }

  session.addEventListener('poll', render);
  render();
}
