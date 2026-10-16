import { node } from '../lib/dom.js';

// Confirmation for permanent deletion. The Delete button only works after the
// user types the confirmation word. With `run`, the request is made inside the
// dialog so its error (e.g. "in the download queue") is shown right there.
// Resolves true when confirmed (and, with `run`, when it succeeded).
function ensureStyle() {
  if (document.getElementById('confirm-delete-style')) return;
  const style = document.createElement('style');
  style.id = 'confirm-delete-style';
  style.textContent = `
  #confirm-delete{width:min(520px,94vw)}
  #confirm-delete ul{margin:8px 0 12px;padding-left:18px;font-size:13px;color:#24364b;max-height:180px;overflow:auto}
  #confirm-delete p{font-size:13px;line-height:1.5;color:#41546b}
  #confirm-delete .delete-warning{padding:10px 12px;border-radius:8px;background:#fff3f2;border:1px solid #f3b8b3;color:#9f2a1f}
  #confirm-delete .delete-warning:empty{display:none}
  #confirm-delete label{margin-top:12px}
  #confirm-delete .delete-error{color:#b42318;min-height:1em}
  .danger-button{background:#b42318;border-color:#b42318;color:#fff}
  .danger-button:hover{background:#912018}
  .danger-button:disabled{background:#d9a29c;border-color:#d9a29c}
  .danger-outline{color:#b42318;border-color:#f3b8b3;background:#fff}
  .danger-outline:hover{background:#fff3f2}`;
  document.head.append(style);
}

export function confirmDelete({ title, items = [], details = '', warning = '', phrase = 'delete', run = null }) {
  ensureStyle();
  let dialog = document.getElementById('confirm-delete');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'confirm-delete';
    document.body.append(dialog);
  }
  return new Promise(resolve => {
    let busy = false, result = false;
    const heading = node('div', undefined, 'dialog-heading');
    heading.append(node('h2', title));
    const list = node('ul');
    const shown = items.slice(0, 8);
    for (const item of shown) list.append(node('li', item));
    if (items.length > shown.length) list.append(node('li', `… and ${items.length - shown.length} more`));
    const input = node('input');
    input.autocomplete = 'off';
    input.spellcheck = false;
    const label = node('label', `Type "${phrase}" to confirm`);
    label.append(input);
    const error = node('p', '', 'delete-error');
    error.setAttribute('role', 'alert');
    const cancel = node('button', 'Cancel');
    cancel.type = 'button';
    const confirm = node('button', 'Delete permanently', 'danger-button');
    confirm.type = 'button';
    confirm.disabled = true;
    const actions = node('div', undefined, 'dialog-actions');
    actions.append(cancel, confirm);
    dialog.replaceChildren(heading, list, node('p', details), node('p', warning, 'delete-warning'), label, error, actions);

    input.addEventListener('input', () => { confirm.disabled = busy || input.value.trim().toLowerCase() !== phrase; });
    cancel.addEventListener('click', () => { if (!busy) dialog.close(); });
    dialog.oncancel = e => { if (busy) e.preventDefault(); };
    dialog.onclose = () => resolve(result);
    confirm.addEventListener('click', async () => {
      if (!run) { result = true; dialog.close(); return; }
      busy = true;
      confirm.disabled = cancel.disabled = true;
      confirm.textContent = 'Deleting…';
      error.textContent = '';
      try {
        await run();
        result = true;
        busy = false;
        dialog.close();
      } catch (e) {
        busy = false;
        error.textContent = e.message;
        confirm.textContent = 'Delete permanently';
        cancel.disabled = false;
        confirm.disabled = input.value.trim().toLowerCase() !== phrase;
      }
    });
    dialog.showModal();
    input.focus();
  });
}
