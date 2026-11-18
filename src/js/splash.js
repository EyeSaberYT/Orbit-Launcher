// The splash screen (index.html #splash): shown while the launcher starts, then lifted away to reveal the
// Play page. It stays up for at least a short moment so its animation plays out instead of flashing.
import { motionReduced } from './motion.js';

const shownAt = performance.now();
const MIN_MS = 1700;
let hiding = null;

/** Lift the splash away. Resolves as it starts to leave, so the launcher can come in underneath. */
export function hideSplash() {
  if (hiding) return hiding;
  const splash = document.getElementById('splash');
  if (!splash) return Promise.resolve();
  const reduced = motionReduced();
  const wait = reduced ? 0 : Math.max(0, MIN_MS - (performance.now() - shownAt));
  hiding = new Promise((resolve) => setTimeout(() => {
    splash.classList.add('is-done');
    // Let the bar finish filling before the splash goes.
    setTimeout(() => {
      splash.classList.add('is-leaving');
      document.documentElement.classList.add('is-revealing');
      const remove = () => {
        splash.remove();
        document.documentElement.classList.remove('is-revealing');
      };
      if (reduced) remove();
      else setTimeout(remove, 760);
      resolve();
    }, reduced ? 0 : 260);
  }, wait));
  return hiding;
}
