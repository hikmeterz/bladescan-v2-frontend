import { node } from '../lib/dom.js';

// Inspection state names and the coloured state pill used across the dashboard.
export const STATE_LABELS = {
  submitted: 'Preparing', running: 'In progress', finalizing: 'Finalizing', succeeded: 'Completed',
  aborted: 'Failed', canceled: 'Canceled', not_sent: 'Not sent', unknown: 'Outcome unknown',
};
export const ROLE_LABELS = { admin: 'Administrator', operator: 'Operator', viewer: 'Viewer' };

export function pill(state) {
  const element = node('span', STATE_LABELS[state] || state, 'pill');
  element.dataset.state = state;
  return element;
}
