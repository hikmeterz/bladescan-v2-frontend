import { $ } from '../lib/dom.js';
import { send as request } from '../lib/api.js';
import { ROLE_LABELS } from './status.js';

// Header account menu: signed-in user, dropdown behaviour and logout.
export function mountAccountMenu() {
  const menu = $('account-menu'), toggle = $('account-toggle');
  const close = () => {
    menu.open = false;
    toggle.setAttribute('aria-expanded', 'false');
  };
  menu.addEventListener('toggle', () => toggle.setAttribute('aria-expanded', String(menu.open)));
  document.addEventListener('click', event => { if (!menu.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (!menu.contains(event.target)) close(); });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { close(); toggle.focus(); }
  });
  $('logout').addEventListener('click', async () => {
    close();
    toggle.focus();
    try {
      await request('/api/auth/logout', {});
      location.replace('/login');
    } catch (e) {
      $('message').textContent = e.message;
    }
  });

  return {
    showUser(user) {
      $('user-name').textContent = user.display_name;
      $('user-role').textContent = ROLE_LABELS[user.role];
      $('avatar').textContent = user.display_name.slice(0, 1).toLocaleUpperCase('en-GB');
    },
  };
}
