// First-time setup: shown once, after the splash, to someone with no instances and no accounts yet.
// Four short steps over the sky: pick a look, bring instances over from another launcher, sign in, play.
// Everything can be skipped and done later (Library > Import, Settings, the account button).
import { importApi } from './api.js';
import { applyMotion, motionPreference, motionReduced } from './motion.js';
import { saveSettings, signIn } from './actions.js';
import { activeAccount, store } from './store.js';
import { html, icon, setHtml } from './ui.js';

const DONE_KEY = 'orbit.onboarded';
const STEPS = ['welcome', 'look', 'import', 'account', 'ready'];

/** The launchers the import step looks for, in the order shown. */
const LAUNCHERS = [
  { kinds: ['prism', 'multimc'], name: 'Prism Launcher', hint: 'Also finds MultiMC', mark: 'P', tint: '#7f6ff0' },
  { kinds: ['modrinth'], name: 'Modrinth App', hint: 'Profiles', mark: 'M', tint: '#1bd96a' },
  { kinds: ['curseforge'], name: 'CurseForge', hint: 'Modpacks and profiles', mark: 'C', tint: '#f16436' },
  { kinds: ['minecraft'], name: 'Minecraft Launcher', hint: 'Your installations', mark: 'J', tint: '#5c9e3a' },
];

function storedDone() {
  try { return localStorage.getItem(DONE_KEY); } catch { return '1'; }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* Shown again next time; harmless. */ }
}

/**
 * After the launcher has loaded: open setup on a first run. Someone who already has instances or an account
 * (an update from an older version) never sees it. `localStorage 'orbit.onboarded' = 'replay'` shows it again.
 */
export function maybeStartOnboarding() {
  const done = storedDone();
  if (done === 'replay') return openOnboarding();
  if (done) return;
  if (store.state.instances.length || store.state.accounts?.length) return markDone();
  openOnboarding();
}

export function openOnboarding() {
  if (document.querySelector('.onboarding')) return;
  let step = 0;
  let scan = null;
  let scanFailed = false;
  const picked = new Set();

  const shell = document.createElement('div');
  shell.className = 'onboarding';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'true');
  shell.setAttribute('aria-label', 'Set up Orbit Launcher');
  shell.innerHTML = '<div class="onboarding-card glass"><div class="onboarding-top"></div><div class="onboarding-stage"></div></div>';
  document.body.append(shell);
  const card = shell.querySelector('.onboarding-card');
  const top = shell.querySelector('.onboarding-top');
  const stage = shell.querySelector('.onboarding-stage');
  document.querySelector('.app')?.setAttribute('inert', '');

  const close = () => {
    markDone();
    document.querySelector('.app')?.removeAttribute('inert');
    off();
    shell.classList.add('is-leaving');
    setTimeout(() => shell.remove(), motionReduced() ? 0 : 520);
  };

  const launcherCount = (launcher) => (scan?.candidates ?? []).filter((c) => launcher.kinds.includes(c.kind)).length;
  const launcherFound = (launcher) => (scan?.sources ?? []).some((s) => launcher.kinds.includes(s.kind) && s.found) || launcherCount(launcher) > 0;

  function view(name) {
    if (name === 'welcome') return html`
      <div class="ob-hero">
        <span class="ob-logo" aria-hidden="true"></span>
        <h1>Welcome to Orbit</h1>
        <p>Let’s get your launcher ready. It only takes a minute, and you can change everything later.</p>
      </div>
      <div class="ob-actions is-center"><button class="btn btn-primary ob-next" data-next autofocus>Get started ${icon('arrow-right', 'icon-sm')}</button></div>`;

    if (name === 'look') {
      const theme = store.state.settings?.theme ?? 'dark';
      const motion = motionPreference();
      return html`
        <div class="ob-head"><span class="ob-step-icon">${icon('sun')}</span><h2>Pick your look</h2><p>Frosted glass over the mountains, in daylight or at dusk.</p></div>
        <div class="ob-themes">
          ${['dark', 'light', 'system'].map((value) => html`<button class="ob-theme ${theme === value ? 'is-picked' : ''}" data-theme-pick="${value}" aria-pressed="${theme === value}">
            <span class="theme-swatch is-${value}"></span><b>${value === 'system' ? 'Match Windows' : value === 'dark' ? 'Dark' : 'Light'}</b>${theme === value ? icon('check-circle', 'icon-sm') : ''}</button>`)}
        </div>
        <label class="ob-toggle"><span><b>Animations</b><small>Smooth page changes, snowfall and motion everywhere.</small></span>
          <input type="checkbox" role="switch" data-motion-pick ${motion !== 'off' ? 'checked' : ''} /></label>
        <div class="ob-actions"><button class="btn btn-ghost" data-back>${icon('chevron-left', 'icon-sm')} Back</button><button class="btn btn-primary ob-next" data-next>Continue ${icon('arrow-right', 'icon-sm')}</button></div>`;
    }

    if (name === 'import') {
      const total = LAUNCHERS.reduce((sum, launcher) => sum + launcherCount(launcher), 0);
      return html`
        <div class="ob-head"><span class="ob-step-icon">${icon('folder-input')}</span><h2>Bring your instances</h2><p>Coming from another launcher? Orbit copies your instances over. The originals stay exactly where they are.</p></div>
        ${!scan && !scanFailed ? html`<div class="ob-scanning" role="status"><span class="ob-radar" aria-hidden="true"><i></i><i></i><i></i></span>Looking for other launchers on this PC…</div>`
          : html`<div class="ob-launchers">${LAUNCHERS.map((launcher, index) => {
              const count = launcherCount(launcher);
              const found = launcherFound(launcher);
              return html`<button class="ob-launcher ${picked.has(launcher.name) ? 'is-picked' : ''} ${count ? '' : 'is-empty'}" data-launcher="${launcher.name}" style="--i:${index};--tint:${launcher.tint}" ${count ? '' : 'disabled'} aria-pressed="${picked.has(launcher.name)}">
                <span class="ob-launcher-mark">${launcher.mark}</span>
                <span class="grow"><b>${launcher.name}</b><small>${count ? `${count} instance${count === 1 ? '' : 's'} found` : found ? 'No instances found' : 'Not installed'}</small></span>
                <span class="ob-check">${icon('check', 'icon-sm')}</span>
              </button>`;
            })}</div>
            ${scanFailed ? html`<p class="ob-note">${icon('info', 'icon-sm')} Couldn’t look for other launchers. You can import any time from Library.</p>` : !total ? html`<p class="ob-note">${icon('info', 'icon-sm')} Nothing to bring over. You can also pick a folder later from Library > Import.</p>` : ''}`}
        <div class="ob-actions"><button class="btn btn-ghost" data-back>${icon('chevron-left', 'icon-sm')} Back</button>
          ${picked.size ? html`<button class="btn btn-primary ob-next" data-import>Choose instances ${icon('arrow-right', 'icon-sm')}</button>` : html`<button class="btn btn-outline ob-next" data-next>Skip for now ${icon('arrow-right', 'icon-sm')}</button>`}</div>`;
    }

    if (name === 'account') {
      const account = activeAccount();
      return html`
        <div class="ob-head"><span class="ob-step-icon">${icon('user')}</span><h2>Sign in to play</h2><p>Use the Microsoft account that owns Minecraft: Java Edition. Your sign-in stays on this PC.</p></div>
        ${account ? html`<div class="ob-signed-in">${icon('check-circle')}<span><b>Signed in as ${account.username}</b><small>You’re ready to play online.</small></span></div>`
          : html`<button class="ob-microsoft" data-sign-in ${store.state.signingIn ? 'disabled' : ''}><span class="ob-ms-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>${store.state.signingIn ? 'Finish signing in in the Microsoft window…' : 'Sign in with Microsoft'}</button>`}
        <div class="ob-actions"><button class="btn btn-ghost" data-back>${icon('chevron-left', 'icon-sm')} Back</button><button class="btn ${account ? 'btn-primary' : 'btn-outline'} ob-next" data-next>${account ? 'Continue' : 'Later'} ${icon('arrow-right', 'icon-sm')}</button></div>`;
    }

    return html`
      <div class="ob-hero is-ready">
        <span class="ob-burst" aria-hidden="true">${Array.from({ length: 12 }, (_, i) => html`<i style="--a:${i * 30}deg"></i>`)}</span>
        <span class="ob-logo" aria-hidden="true"></span>
        <h1>You’re all set</h1>
        <p>${activeAccount() ? `Welcome, ${activeAccount().username}.` : 'Welcome aboard.'} Pick an instance and press Play.</p>
      </div>
      <div class="ob-actions is-center"><button class="btn btn-primary ob-next" data-finish autofocus>${icon('play', 'icon-sm icon-fill')} Start playing</button></div>`;
  }

  function draw(direction = 0) {
    setHtml(top, html`
      <div class="ob-dots" aria-label="Step ${step + 1} of ${STEPS.length}">${STEPS.map((_, i) => html`<i class="${i === step ? 'is-current' : i < step ? 'is-done' : ''}"></i>`)}</div>
      ${step < STEPS.length - 1 && html`<button class="ob-skip" data-skip>Skip setup</button>`}`);
    const next = document.createElement('div');
    next.className = 'ob-view';
    setHtml(next, view(STEPS[step]));
    const old = stage.querySelector('.ob-view:not(.is-out)');
    if (old && direction && !motionReduced()) {
      // The card eases to the new step's height while one step slides out and the next slides in.
      card.style.height = `${card.offsetHeight}px`;
      old.classList.add('is-out');
      old.style.setProperty('--dir', direction);
      next.style.setProperty('--dir', direction);
      next.classList.add('is-in');
      stage.append(next);
      requestAnimationFrame(() => {
        card.style.height = `${top.offsetHeight + next.offsetHeight + parseFloat(getComputedStyle(card).paddingTop) * 2}px`;
      });
      setTimeout(() => { old.remove(); next.classList.remove('is-in'); card.style.height = ''; }, 520);
    } else {
      stage.replaceChildren(next);
    }
    next.querySelector('[autofocus]')?.focus({ preventScroll: true });
  }

  const go = (delta) => {
    step = Math.max(0, Math.min(STEPS.length - 1, step + delta));
    draw(delta);
    if (STEPS[step] === 'import' && !scan && !scanFailed) {
      const started = performance.now();
      importApi.scan()
        .then((result) => { scan = result; })
        .catch(() => { scanFailed = true; })
        // Long enough to see the search happen.
        .finally(() => setTimeout(() => STEPS[step] === 'import' && draw(), Math.max(0, 900 - (performance.now() - started))));
    }
  };

  shell.addEventListener('click', async (event) => {
    const target = event.target;
    if (target.closest('button:disabled')) return;
    if (target.closest('[data-next]')) return go(1);
    if (target.closest('[data-back]')) return go(-1);
    if (target.closest('[data-skip], [data-finish]')) return close();
    const theme = target.closest('[data-theme-pick]');
    if (theme) {
      saveSettings({ theme: theme.dataset.themePick }).catch(() => {}).finally(() => draw());
      return;
    }
    const launcher = target.closest('[data-launcher]');
    if (launcher) {
      const name = launcher.dataset.launcher;
      if (picked.has(name)) picked.delete(name); else picked.add(name);
      return draw();
    }
    if (target.closest('[data-import]')) {
      // The import dialog opens on top; setup carries on underneath for when it closes.
      go(1);
      (await import('./dialogs/import-launcher.js')).openImportLauncherDialog();
      return;
    }
    if (target.closest('[data-sign-in]')) {
      signIn();
      draw();
    }
  });
  shell.addEventListener('change', (event) => {
    if (event.target.matches('[data-motion-pick]')) applyMotion(event.target.checked ? 'on' : 'off');
  });
  const off = store.on(['accounts', 'signingIn'], () => STEPS[step] === 'account' && draw());

  draw();
  requestAnimationFrame(() => shell.classList.add('is-open'));
}
