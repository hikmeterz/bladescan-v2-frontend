// Desktop layout: align the content with the logo and avatar edges, and
// let the history panel fill the remaining viewport height.
export function mountLayout() {
  const header = document.querySelector('.dashboard-header');
  const logo = header?.querySelector('.dashboard-logo img');
  const avatar = document.getElementById('avatar');
  const main = document.querySelector('main.workspace');
  if (!header || !logo || !avatar || !main) return;

  let frame, timer;
  const align = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const left = logo.getBoundingClientRect().right, right = avatar.getBoundingClientRect().left;
      const width = document.documentElement.clientWidth;
      const desktop = width > 900 && right - left >= 600;
      main.style.paddingLeft = desktop ? `${left}px` : '';
      main.style.paddingRight = desktop ? `${width - right}px` : '';
    });
  };
  const fit = () => {
    const desktop = window.innerWidth > 900 && window.innerHeight >= 700;
    main.classList.toggle('viewport-dashboard', desktop);
    if (desktop) main.style.height = Math.max(0, window.innerHeight - main.getBoundingClientRect().top) + 'px';
    else main.style.removeProperty('height');
  };
  const scheduleFit = () => { clearTimeout(timer); timer = setTimeout(fit, 150); };

  new ResizeObserver(align).observe(header);
  new ResizeObserver(align).observe(document.getElementById('account-toggle'));
  new ResizeObserver(scheduleFit).observe(header);
  window.addEventListener('resize', () => { align(); scheduleFit(); });
  logo.addEventListener('load', align);
  document.fonts.ready.then(() => { align(); scheduleFit(); });
  align();
  fit();
}
