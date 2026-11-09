// Related startup failures share one in-flow region, never a stack over launch controls.
import { refreshLauncherData } from '../actions.js';
import { store } from '../store.js';
import { isTauri } from '../tauri.js';
import { html, icon, setHtml } from '../ui.js';

export function mountStartupStatus(root) {
  let dismissed = '';
  let signature = '';
  let wasBusy = false;
  const draw = () => {
    const failures = Object.entries(store.state.loadErrors).filter(([, error]) => error);
    signature = JSON.stringify(failures);
    const busy = store.state.refreshingData;
    root.hidden = !failures.length || (signature === dismissed && !busy);
    // Keep the retry button's DOM node and keyboard focus stable while retrying.
    if (root.dataset.signature === signature) {
      const retry = root.querySelector('[data-retry]');
      if (retry) {
        retry.disabled = busy;
        retry.textContent = busy ? 'Reconnecting…' : 'Retry connection';
        if (wasBusy && !busy) retry.focus({ preventScroll: true });
      }
      wasBusy = busy;
      return;
    }
    root.dataset.signature = signature;
    setHtml(root, html`<div class="startup-message" role="status">
      <strong>Launcher data is unavailable</strong>
      <span>${isTauri ? `Could not load ${failures.map(([key]) => key).join(', ')}. Retry to reconnect.` : 'Open the desktop launcher to connect, or retry.'}</span>
    </div><div class="startup-actions">
      <button class="btn btn-outline" data-retry ${busy ? 'disabled' : ''}>${busy ? 'Reconnecting…' : 'Retry connection'}</button>
      <button class="btn btn-icon" data-dismiss aria-label="Dismiss connection notice">${icon('x')}</button>
    </div>`);
    wasBusy = busy;
  };
  root.addEventListener('click', (event) => {
    if (event.target.closest('[data-dismiss]')) {
      dismissed = signature;
      root.hidden = true;
      document.querySelector('.nav-tab[aria-current="page"]')?.focus();
    }
    if (event.target.closest('[data-retry]')) {
      dismissed = '';
      refreshLauncherData();
    }
  });
  store.on(['loadErrors', 'refreshingData'], draw);
  draw();
}
