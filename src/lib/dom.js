// Small DOM helpers shared by every page.
export const $ = id => document.getElementById(id);

export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

// Close a <dialog> when the user clicks the dimmed backdrop outside it.
export function closeOnBackdrop(dialog, close = () => dialog.close()) {
  dialog.addEventListener('click', event => {
    const r = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < r.left || event.clientX > r.right
        || event.clientY < r.top || event.clientY > r.bottom)) close();
  });
}
