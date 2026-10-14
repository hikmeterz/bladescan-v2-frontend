import { $, node } from '../lib/dom.js';
import { send as request } from '../lib/api.js';
import { ROLE_LABELS } from './status.js';

// Administrator-only user list and "New user" form.
export function mountUsers() {
  async function list() {
    try {
      const d = await request('/api/users');
      $('users-list').replaceChildren(...d.users.map(u =>
        node('p', `${u.display_name} · ${u.username} · ${ROLE_LABELS[u.role]}${u.is_active ? '' : ' · Inactive'}`)));
    } catch (e) {
      $('user-message').textContent = e.message;
    }
  }
  $('users-button').addEventListener('click', () => { $('users-dialog').showModal(); list(); });
  $('user-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('create-user').disabled = true;
    $('user-message').textContent = '';
    try {
      await request('/api/users', Object.fromEntries(new FormData(e.target)));
      e.target.reset();
      $('user-message').textContent = 'User created.';
      list();
    } catch (error) {
      $('user-message').textContent = error.message;
    } finally {
      $('create-user').disabled = false;
    }
  });
  return { show(user) { $('users-button').hidden = user.role !== 'admin'; } };
}
