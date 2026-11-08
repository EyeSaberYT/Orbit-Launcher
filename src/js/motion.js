// Shared, interruptible feedback. No animation library or artificial loading delay.
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const running = new WeakMap();
const active = new Set();

reducedMotion.addEventListener('change', event => {
  if (event.matches) for (const animation of active) animation.finish();
});

export function animateSurface(node, { closing = false, from = 0, offset = 6 } = {}) {
  if (!node?.isConnected || !node.animate || reducedMotion.matches) return Promise.resolve();
  const current = getComputedStyle(node);
  const start = { opacity: current.opacity, transform: current.transform };
  const previous = running.get(node);
  previous?.cancel();
  const tokens = getComputedStyle(document.documentElement);
  const animation = node.animate(closing
    ? [start, { opacity: 0, transform: offset ? `translateY(${offset}px) scale(.99)` : 'none' }]
    : [{ opacity: from, transform: `translateY(${offset}px)` }, { opacity: 1, transform: 'none' }], {
    duration: parseFloat(tokens.getPropertyValue('--motion-duration')) || 180,
    easing: tokens.getPropertyValue('--motion-ease').trim() || 'ease-out',
    fill: 'both',
  });
  running.set(node, animation);
  active.add(animation);
  return animation.finished.catch(() => {}).finally(() => {
    active.delete(animation);
    if (running.get(node) === animation) {
      running.delete(node);
      animation.cancel();
    }
  });
}

export function dismissSurface(node) {
  node.inert = true;
  node.style.pointerEvents = 'none';
  return animateSurface(node, { closing: true, offset: node.classList.contains('modal-backdrop') ? 0 : 4 }).then(() => node.remove());
}

export function mountNavIndicator(nav) {
  const pill = document.createElement('span');
  pill.className = 'nav-glider';
  pill.setAttribute('aria-hidden', 'true');
  pill.hidden = true;
  nav.prepend(pill);
  let selected;
  const position = () => {
    if (!selected?.isConnected) return;
    pill.hidden = false;
    pill.style.width = `${selected.offsetWidth}px`;
    pill.style.height = `${selected.offsetHeight}px`;
    pill.style.top = `${selected.offsetTop}px`;
    pill.style.transform = `translateX(${selected.offsetLeft}px)`;
    if (!pill.classList.contains('is-ready')) requestAnimationFrame(() => pill.classList.add('is-ready'));
  };
  new ResizeObserver(position).observe(nav);
  return tab => {
    selected = tab;
    if (!tab) pill.hidden = true;
    else position();
  };
}
