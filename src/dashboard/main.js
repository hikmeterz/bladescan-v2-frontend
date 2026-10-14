import { $ } from '../lib/dom.js';
import { send as request } from '../lib/api.js';
import { mountAccountMenu } from './account.js';
import { mountHardwareStatus } from './hardware.js';
import { mountLayout } from './layout.js';
import { mountUsers } from './users.js';
import { createHistory } from './history.js';
import { createRobotStatus } from './robot-status.js';
import { openDetails } from './details.js';
import { openInspectionProgress } from './progress.js';

// Dashboard entry point: builds each page section and connects them.
let me = null;
const getMe = () => me;

for (const button of document.querySelectorAll('[data-close]'))
  button.addEventListener('click', () => $(button.dataset.close).close());

const account = mountAccountMenu();
mountHardwareStatus($('hardware-slot'));
const users = mountUsers();
const history = createHistory({ getMe, onDetails: openDetails, onProgress: openInspectionProgress });
const robot = createRobotStatus({ getMe });
$('refresh').addEventListener('click', () => { history.load(); robot.refresh(); });

try {
  me = (await request('/api/auth/me')).user;
  account.showUser(me);
  users.show(me);
  await Promise.all([history.load(), robot.refresh()]);
  setInterval(() => { if (!document.hidden) robot.refresh(); }, 4000);
} catch (e) {
  $('message').textContent = e.message;
}
mountLayout();
