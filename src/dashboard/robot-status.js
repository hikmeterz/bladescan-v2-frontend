import { $, node } from '../lib/dom.js';
import { send as request } from '../lib/api.js';
import { createInspectionOptions } from './inspection-options.js';

// Robot status banner and the "New inspection" form. A start request whose
// outcome is unknown is never resent; the banner poll resolves it instead.
export function createRobotStatus({ getMe }) {
  let busy = false, starting = false, uncertain = false, recovering = false;
  let recoveryError = '';
  const options = createInspectionOptions({
    form: $('new-form'), button: $('start'), message: $('start-message'), request,
    isBusy: () => starting || uncertain,
  });

  async function refresh() {
    if (busy) return;
    busy = true;
    const me = getMe();
    try {
      const [current, robot] = await Promise.all([request('/api/inspections/current'), request('/api/robot/state')]);
      const banner = $('banner');
      banner.replaceChildren();
      banner.classList.toggle('warn', !!current.robot_busy || !robot.rosbridgeConnected || robot.stale);
      let text = '';
      if (current.blocked) text = 'Robot is busy with another inspection or one with no assigned owner.';
      if (current.active) text = current.inspection.state === 'unknown'
        ? recoveryError ||
          'Inspection outcome is unknown. Check its status before starting a new recording.'
        : 'You have an inspection in progress.';
      if (current.inspection?.state !== 'unknown') recoveryError = '';
      banner.hidden = !text;
      banner.append(node('span', text));

      if (current.active) {
        const actions = node('div', undefined, 'banner-actions');
        const link = node('a', 'Return to inspection →');
        link.href = '/inspection';
        actions.append(link);

        if (
          current.inspection?.state === 'unknown' &&
          current.inspection?.operator_user_id === me.id &&
          me.role !== 'viewer'
        ) {
          const recover = node(
            'button',
            recovering ? 'Recovering…' : 'Recover',
            'banner-recover',
          );
          recover.type = 'button';
          recover.disabled = recovering;

          recover.addEventListener('click', async () => {
            if (recovering) return;
            recovering = true;
            recover.disabled = true;
            recover.textContent = 'Recovering…';

            try {
              recoveryError = '';
              await request(
                `/api/inspections/${current.inspection.request_id}/recover`,
                {},
              );
            } catch (error) {
              recoveryError =
                'Recovery could not be confirmed. ' + error.message;
            } finally {
              recovering = false;
              refresh();
            }
          });

          actions.append(recover);
        }

        banner.append(actions);
      }

      $('new-button').disabled = starting || uncertain || recovering ||
        me.role === 'viewer' || current.robot_busy ||
        !robot.rosbridgeConnected || robot.stale;
      if (uncertain && current.active && current.inspection?.operator_user_id === me.id) location.assign('/inspection');
    } catch (e) {
      $('banner').hidden = false;
      $('banner').textContent = 'Connection unavailable. ' + e.message;
      $('new-button').disabled = true;
    } finally {
      busy = false;
    }
  }

  $('new-button').addEventListener('click', () => { $('new-dialog').showModal(); options.open(); });
  $('new-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (starting || uncertain) return;
    if (!options.valid()) { $('start-message').textContent = 'Select all inspection fields from the lists.'; return; }
    const selection = Object.fromEntries(new FormData(e.target));
    starting = true;
    options.sync();
    $('start-message').textContent = 'Starting inspection…';
    try {
      const d = await request('/api/inspections', selection);
      if (!d.inspection?.request_id) throw Error('Response could not be verified.');
      location.assign('/inspection');
    } catch (error) {
      uncertain = !error.status || error.status >= 500;
      $('start-message').textContent = error.message + (uncertain ? ' Checking the request outcome; it will not be sent again.' : '');
    } finally {
      starting = false;
      options.sync();
      refresh();
    }
  });
  return { refresh };
}
