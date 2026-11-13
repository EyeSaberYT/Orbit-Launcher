// Orbit Client updates itself: while the launcher is open it looks for a new release of the mod and
// gives it to every instance that has it, so the update is already there at the next launch.
// (A launch still checks too, which covers an instance that was running during an update.)
import * as api from './api.js';
import { refreshInstances } from './actions.js';
import { toast } from './ui.js';

const FIRST_CHECK_MS = 5000;
const EVERY_MS = 30 * 60 * 1000;
let checking = false;

/** "A", "A and B", "A, B and C". */
const listNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] ?? '');

/** One check. Quiet unless something was updated: offline or GitHub unreachable just waits for the next one. */
export async function checkOrbitClientUpdates() {
  if (checking || !navigator.onLine) return;
  checking = true;
  try {
    const result = await api.orbit.updateAll();
    if (!result) return;
    // A failed download sends no "finished" progress: clear the footer as other failed tasks do.
    if (result.failed) window.dispatchEvent(new CustomEvent('orbit:task-failed', { detail: { command: 'orbit_client_update_all' } }));
    if (result.updated.length) {
      toast(`Orbit Client updated to ${result.version}`, {
        kind: 'success',
        description: `In ${listNames(result.updated)}. It loads the next time ${result.updated.length > 1 ? 'they start' : 'it starts'}.`,
      });
      refreshInstances();
    }
  } catch (error) {
    console.warn('Orbit Client update check failed', error);
  } finally {
    checking = false;
  }
}

export function startOrbitClientUpdates() {
  setTimeout(checkOrbitClientUpdates, FIRST_CHECK_MS);
  setInterval(checkOrbitClientUpdates, EVERY_MS);
  window.addEventListener('online', checkOrbitClientUpdates);
}
