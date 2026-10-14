import { $ } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { InspectionSession } from './session.js';
import { createPreview } from './preview.js';
import { createView } from './view.js';
import { createTeleop } from './teleop.js';
import { mountCommands } from './commands.js';
import { mountControls } from './controls.js';
import { startHardwareStatus } from './hardware.js';

// Live inspection screen entry point: wires the session poll to the view,
// teleop, preview, commands and deck controls.
const { user } = await api.me();
const session = new InspectionSession({ user });
const dialog = $('inspection-dialog');
const preview = createPreview(session);
const view = createView({ session, dialog, preview });
const teleop = createTeleop({ session, isBlocked: () => dialog.open });
const refresh = () => { view.render(); teleop.syncUi(); };

mountCommands({ session, teleop, refresh });
mountControls(session);
const stopHardware = startHardwareStatus();

// Inspection information dialog: driving stops while it is open.
$('details-button').addEventListener('click', () => { teleop.stop(); view.renderInformation(); dialog.showModal(); teleop.syncUi(); });
for (const id of ['dialog-close', 'dialog-cancel']) $(id).addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { teleop.stop(); teleop.syncUi(); });

// Fullscreen toggle.
const fullscreen = $('fullscreen-button');
fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('console').requestFullscreen();
  } catch {
    $('ui-message').textContent = 'Could not enter fullscreen.';
    $('ui-message').hidden = false;
    setTimeout(() => { $('ui-message').hidden = true; }, 4000);
  }
});
document.addEventListener('fullscreenchange', () => {
  const on = document.fullscreenElement === $('console');
  fullscreen.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreen.title = on ? 'Exit fullscreen' : 'Fullscreen';
  fullscreen.setAttribute('aria-pressed', String(on));
  fullscreen.querySelector('path').setAttribute('d', on
    ? 'M3 8h5V3m8 0v5h5M8 21v-5H3m18 0h-5v5' : 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5');
});

// After a confirmed finish or cancel, return to the dashboard.
let leaving = false;
session.addEventListener('poll', () => {
  refresh();
  if (!leaving && session.readyToLeave()) {
    leaving = true;
    teleop.stop();
    location.replace('/dashboard');
  }
});

const renderTimer = setInterval(refresh, 250);
window.addEventListener('pagehide', () => {
  session.stop();
  clearInterval(renderTimer);
  preview.stop();
  stopHardware();
});
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });

refresh();
session.start();
preview.start();
teleop.connect();
