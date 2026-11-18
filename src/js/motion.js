// Shared, interruptible feedback. No animation library or artificial loading delay.
const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const running = new WeakMap();
const active = new Set();

// ---------- Animations setting (Settings > Appearance) ----------
// 'on' (the default), 'off', or 'system' to follow Windows' "Animation effects". Kept on this computer
// like the accent colour. While off, <html data-reduce-motion> stills the CSS and these helpers skip.
const MOTION_KEY = 'orbit.motion';
const motionListeners = new Set();

export function motionPreference() {
  try {
    const value = localStorage.getItem(MOTION_KEY);
    if (value === 'off' || value === 'system') return value;
  } catch {
    // Storage unavailable: the default.
  }
  return 'on';
}

export function motionReduced() {
  const preference = motionPreference();
  return preference === 'off' || (preference === 'system' && systemReduced.matches);
}

/** Apply the setting (saving `preference` first when given) and tell anything that animates. */
export function applyMotion(preference) {
  if (preference) {
    try {
      localStorage.setItem(MOTION_KEY, preference);
    } catch {
      // Not saved; still applied for now.
    }
  }
  const reduced = motionReduced();
  document.documentElement.toggleAttribute('data-reduce-motion', reduced);
  if (reduced) for (const animation of active) animation.finish();
  motionListeners.forEach((fn) => fn(reduced));
}

export function onMotionChange(fn) {
  motionListeners.add(fn);
  return () => motionListeners.delete(fn);
}

systemReduced.addEventListener('change', () => applyMotion());
applyMotion();

export function animateSurface(node, { closing = false, from = 0, offset = 6 } = {}) {
  if (!node?.isConnected || !node.animate || motionReduced()) return Promise.resolve();
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

const token = (name, fallback) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;

/**
 * The pieces of a page to fade. Fading a whole page would make its frosted glass panels lose their blur
 * for the length of the fade (a faded parent hides what is behind it from the glass) and then snap back.
 * So each glass panel fades by itself, and so does anything that holds no glass; only wrappers around
 * glass are skipped (they are moved, not faded).
 */
function fadePieces(root) {
  const glass = [...root.querySelectorAll('*')].filter((el) => {
    const filter = getComputedStyle(el).backdropFilter;
    return filter && filter !== 'none';
  });
  const pieces = [];
  const walk = (node, depth) => {
    for (const child of node.children) {
      if (pieces.length >= 120) return;
      const holdsGlass = glass.some((g) => g !== child && child.contains(g));
      if (!holdsGlass || depth >= 8) pieces.push(child);
      else walk(child, depth + 1);
    }
  };
  walk(root, 0);
  return pieces;
}

/** How long a page takes to leave, so the router can start the next one as it finishes. */
export function leaveDuration(quick = false) {
  return motionReduced() ? 0 : token(quick ? '--page-leave-quick' : '--page-leave', quick ? 140 : 220);
}

/**
 * The page being left: lifted out of the layout exactly where and as big as it is (so nothing jumps),
 * faded and drifted up, then removed. `quick` is for switching between tabs of the same page.
 */
export function leavePage(page, view, { quick = false } = {}) {
  if (motionReduced() || !page.animate) {
    page.remove();
    return;
  }
  const box = { top: page.offsetTop - view.scrollTop, left: page.offsetLeft, width: page.offsetWidth, height: page.offsetHeight };
  Object.assign(page.style, {
    position: 'absolute',
    top: `${box.top}px`,
    left: `${box.left}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
    margin: '0',
    zIndex: '1',
    pointerEvents: 'none',
  });
  page.inert = true;
  page.setAttribute('aria-hidden', 'true');
  page.classList.add('is-leaving');
  const timing = { duration: leaveDuration(quick), easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' };
  const moves = [page.animate([{ transform: 'none' }, { transform: `translateY(${quick ? -4 : -8}px)` }], timing)];
  for (const piece of fadePieces(page)) moves.push(piece.animate([{ opacity: getComputedStyle(piece).opacity }, { opacity: 0 }], timing));
  Promise.all(moves.map((a) => a.finished.catch(() => {}))).finally(() => page.remove());
}

/**
 * The new page rising and fading in, piece by piece (see fadePieces). Cards and rows inside it also rise
 * in one after another for a moment after it opens (`.is-entering` in motion.css).
 */
export function enterPage(page, { quick = false } = {}) {
  page.style.visibility = '';
  if (motionReduced() || !page.animate) return;
  page.classList.add('is-entering');
  const timing = {
    duration: token(quick ? '--page-enter-quick' : '--page-enter', quick ? 220 : 340),
    easing: 'cubic-bezier(.16,1,.3,1)',
    fill: 'backwards',
  };
  page.animate([{ transform: `translateY(${quick ? 5 : 12}px)` }, { transform: 'none' }], timing);
  for (const piece of fadePieces(page)) piece.animate([{ opacity: 0 }, { opacity: 1 }], timing);
  setTimeout(() => page.classList.remove('is-entering'), 1400);
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
