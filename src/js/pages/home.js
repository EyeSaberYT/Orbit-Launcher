// Glass controls keep instances and launch actions close without covering the landscape.
import {
  featuredServer, launchInstance, orbitInstance, playOrbitClient,
  refreshLauncherData, runningCount, spotlightInstance, stopInstance,
} from '../actions.js';
import { openNewInstanceDialog } from '../dialogs/new-instance.js';
import { revealInstanceFolder } from './instance/shared.js';
import { navigate } from '../router.js';
import { activeAccount, prefs, store } from '../store.js';
import { launcherAvailability } from '../load-state.js';
import { mountNewsFeed } from '../components/news-feed.js';
import { animateSurface } from '../motion.js';
import { formatDuration, html, icon, instanceIcon, loaderLabel, relativeTime, setHtml, showMenu, spinner } from '../ui.js';

const ORBIT_PLACEHOLDER = {
  id: '__orbit-client', name: 'Orbit Client', gameVersion: '1.21.11',
  loader: 'fabric', modCount: 0, tags: ['orbit-client'], placeholder: true,
};

function instances() {
  const list = [...store.state.instances].sort((a, b) =>
    new Date(b.lastPlayed ?? 0) - new Date(a.lastPlayed ?? 0) || a.name.localeCompare(b.name));
  const orbit = orbitInstance();
  return [orbit ?? ORBIT_PLACEHOLDER, ...list.filter((item) => item.id !== orbit?.id)];
}

function selectedInstance() {
  const list = instances();
  const id = prefs.get('play.selected', null) ?? spotlightInstance()?.id;
  return list.find((item) => item.id === id) ?? list[0];
}

const instanceArtwork = (item, size = 48) => instanceIcon(item, size);

export function render(root) {
  root.classList.add('page-play');
  setHtml(root, html`<div class="play-home">
    <header class="home-intro" aria-labelledby="home-heading">
      <div class="edition-label">${icon('gamepad')} Minecraft: Java Edition</div>
      <h1 id="home-heading">Minecraft.<br>Your way.</h1>
      <p>Your worlds. Your adventures. Your Minecraft.</p>
      <a class="home-explore" href="#/discover">Find something new ${icon('arrow-right', 'icon-sm')}</a>
    </header>
    <div class="home-bottom">
      <div class="home-dashboard">
        <section class="launch-card glass" aria-label="Selected instance" data-launch-card></section>
        <section class="home-library glass" aria-labelledby="home-library-heading" data-library></section>
      </div>
      <aside class="home-news glass" aria-labelledby="home-news-heading" data-news-feed></aside>
      <div class="home-footer"><span class="home-welcome" data-welcome></span><span>Made for the way you play.</span></div>
    </div>
  </div>`);

  const disposeNews = mountNewsFeed(root.querySelector('[data-news-feed]'));
  const launchEl = root.querySelector('[data-launch-card]');
  const libraryEl = root.querySelector('[data-library]');
  const select = (id) => {
    const changed = selectedInstance().id !== id;
    prefs.set('play.selected', id);
    draw();
    if (changed) void animateSurface(launchEl, { from: .85, offset: 3 });
  };

  function draw() {
    const availability = launcherAvailability(store.state);
    const knownInstances = availability.instances === 'ready';
    launchEl.classList.toggle('is-loading', availability.instances === 'loading');
    const selected = selectedInstance();
    const list = instances();
    const running = store.state.running.has(selected.id);
    const launching = store.state.launching.has(selected.id) || (selected.placeholder && store.state.orbitInstalling);
    const copies = runningCount(selected.id);
    const server = featuredServer();
    const defaultMemory = store.state.settings?.defaultMemoryMax ?? 4096;
    const ownMemory = selected.memoryMax > 0 ? selected.memoryMax : null;
    const memory = ((ownMemory ?? defaultMemory) / 1024).toFixed(1);
    const memoryLabel = ownMemory && ownMemory !== defaultMemory ? 'configured' : 'default';
    // `installed` means the game files are on disk; otherwise Play downloads them first.
    const needsInstall = selected.placeholder || selected.installed === false;
    const status = running ? (copies > 1 ? `${copies} games running` : 'Game running') : !availability.canLaunch ? (availability.unavailable ? 'Data unavailable' : 'Loading launcher data') : launching ? 'Preparing game' : needsInstall ? 'Ready to install' : 'Ready to play';

    setHtml(launchEl, html`
      <div class="launch-card-top">
        <span class="home-section-label">Let’s play</span>
        <span class="home-state ${running ? 'is-live' : ''} ${!availability.canLaunch && !running ? 'is-unavailable' : ''}" role="status"><i class="${launching ? 'is-busy' : ''}"></i>${status}</span>
      </div>
      <div class="selected-instance">
        ${instanceArtwork(selected, 56)}
        <div class="grow"><h2 class="truncate">${selected.name}</h2><p>${knownInstances ? html`Minecraft ${selected.gameVersion}<span class="meta-dot">·</span>${loaderLabel(selected.loader)}` : availability.unavailable ? 'Instance data unavailable' : 'Waiting for your instance data'}</p></div>
        <button class="home-round-btn" data-switch aria-label="Change selected instance" aria-haspopup="menu" ${!knownInstances ? 'disabled' : ''}>${icon('chevron-down')}</button>
      </div>
      <div class="home-instance-meta">
        <span>${icon('package')} ${knownInstances ? selected.modCount ?? 0 : '-'} mods</span>
        <span>${icon('cpu')} ${availability.settings === 'ready' ? memory : '-'} GB ${memoryLabel}</span>
        <span>${icon('clock')} ${knownInstances ? formatDuration(selected.playTimeSecs ?? 0) : '-'}</span>
      </div>
      <div class="home-launch-actions">
        ${running
          ? html`<button class="home-play-btn is-stop" data-stop="${selected.id}">${icon('square')} Stop game</button>`
          : !availability.canLaunch
            ? html`<button class="home-play-btn" data-retry-data ${store.state.refreshingData || !availability.unavailable ? 'disabled' : ''}>${icon('refresh')}${store.state.refreshingData ? 'Reconnecting…' : availability.unavailable ? 'Retry connection' : 'Loading launcher data…'}${icon('arrow-right')}</button>`
          : html`<button class="home-play-btn" data-launch ${launching ? 'disabled' : ''}>${launching ? spinner() : icon('play', 'icon-fill')}${launching ? 'Preparing game…' : needsInstall ? 'Install & play' : 'Play Minecraft'}${!launching && icon('arrow-right')}</button>`}
        ${!selected.placeholder && html`<button class="home-round-btn home-manage" data-go="/instance/${selected.id}" aria-label="Manage ${selected.name}" data-tip="Manage instance">${icon('settings')}</button>`}
      </div>
      <div class="home-launch-foot">
        ${!availability.canLaunch && !running
          ? html`<span>${icon('info', 'icon-sm')} Connect to check installation and launch readiness.</span>`
          : running
          ? html`<button class="home-text-btn" data-launch-another ${launching ? 'disabled' : ''}>${icon('plus', 'icon-sm')} Launch another copy</button>`
          : server
            ? html`<button class="home-text-btn" data-join ${launching ? 'disabled' : ''}>${icon('globe', 'icon-sm')} Join featured server ${icon('external', 'icon-sm')}</button>`
            : html`<span>${selected.placeholder ? 'Fabric + Orbit Client' : ''}</span>`}
        ${!selected.placeholder && html`<button class="home-text-btn" data-folder="${selected.id}" aria-label="Open instance folder" data-tip="Open folder">${icon('folder', 'icon-sm')}</button>`}
      </div>`);

    const scroll = libraryEl.querySelector('.home-instance-list')?.scrollTop ?? 0;
    setHtml(libraryEl, html`
      <div class="home-library-head"><h2 id="home-library-heading">Your instances <span>${knownInstances ? store.state.instances.length : '-'}</span></h2><button class="home-round-btn" data-new aria-label="Create new instance" data-tip="New instance" ${!availability.canLaunch ? 'disabled' : ''}>${icon('plus')}</button></div>
      <div class="home-instance-list" aria-label="Choose an instance">
        ${!knownInstances ? html`<div class="home-library-state"><strong>${availability.instances === 'unavailable' ? 'Instances unavailable' : 'Loading your instances…'}</strong>${availability.instances === 'loading' && html`<div class="instance-loading-rows" aria-hidden="true">${[0,1,2].map(() => html`<span></span>`)}</div>`}${availability.instances === 'unavailable' && html`<button class="home-text-btn" data-retry-data ${store.state.refreshingData ? 'disabled' : ''}>${icon('refresh', 'icon-sm')} ${store.state.refreshingData ? 'Reconnecting…' : 'Retry connection'}</button>`}</div>` : list.map((item) => html`<button class="home-instance-row ${item.id === selected.id ? 'is-selected' : ''}" data-select="${item.id}" aria-pressed="${item.id === selected.id}">
          ${instanceArtwork(item, 38)}
          <span class="grow"><b class="truncate">${item.name}</b><small>${item.gameVersion}<span class="meta-dot">·</span>${item.placeholder ? 'Get started' : loaderLabel(item.loader)}</small></span>
          ${store.state.running.has(item.id) ? html`<span class="instance-live-dot" aria-label="Running"></span>` : item.id === selected.id ? html`<span class="instance-selected-mark">${icon('check', 'icon-sm')}</span>` : icon('chevron-right', 'icon-sm')}
        </button>`)}
      </div>
      ${knownInstances && !store.state.instances.length && html`<div class="home-library-state home-library-empty"><strong>No installed instances yet</strong><p>Install Orbit Client to get started, or create your own Minecraft setup.</p><button class="home-text-btn" data-new ${!availability.canLaunch ? 'disabled' : ''}>${icon('plus', 'icon-sm')} Create new instance</button></div>`}
      <a class="home-library-link" href="#/library">Open library ${icon('arrow-right', 'icon-sm')}</a>`);
    libraryEl.querySelector('.home-instance-list').scrollTop = scroll;
    const account = activeAccount();
    setHtml(root.querySelector('[data-welcome]'), html`${icon('sun')} ${account ? `Welcome back, ${account.username}.` : 'Welcome to Orbit.'}`);
  }

  const launchSelected = (quickPlay) => {
    const selected = selectedInstance();
    return selected.tags?.includes('orbit-client') ? playOrbitClient(quickPlay) : launchInstance(selected.id, quickPlay);
  };

  const onClick = (event) => {
    const target = event.target;
    if (target.closest('button:disabled')) return;
    if (target.closest('[data-retry-data]')) return refreshLauncherData();
    const go = target.closest('[data-go]');
    if (go) return navigate(go.dataset.go);
    if (target.closest('[data-new]')) return openNewInstanceDialog();
    const row = target.closest('[data-select]');
    if (row) return select(row.dataset.select);
    const switcher = target.closest('[data-switch]');
    if (switcher) return showMenu(switcher, [
      { header: 'Choose an instance' },
      ...instances().map((item) => ({ label: item.name, trail: item.id === selectedInstance().id ? 'Selected' : item.gameVersion, onSelect: () => select(item.id) })),
      { separator: true }, { label: 'New instance', icon: 'plus', onSelect: openNewInstanceDialog },
    ], { align: 'end' });
    if (target.closest('[data-launch], [data-launch-another]')) return launchSelected();
    if (target.closest('[data-join]')) return launchSelected({ type: 'multiplayer', address: featuredServer() });
    const stop = target.closest('[data-stop]');
    if (stop) return stopInstance(stop.dataset.stop, selectedInstance().name);
    const folder = target.closest('[data-folder]');
    if (folder) return revealInstanceFolder(folder.dataset.folder);
  };

  const onContextMenu = (event) => {
    const row = event.target.closest('[data-select]');
    const item = row && store.state.instances.find((instance) => instance.id === row.dataset.select);
    if (!item) return;
    event.preventDefault();
    showMenu(row, [
      { header: item.name },
      { label: 'Select instance', icon: 'check', onSelect: () => select(item.id) },
      { label: 'Play Minecraft', icon: 'play', onSelect: () => launchInstance(item.id) },
      { label: 'Manage instance', icon: 'settings', onSelect: () => navigate(`/instance/${item.id}`) },
      { label: 'Open folder', icon: 'folder', onSelect: () => revealInstanceFolder(item.id) },
      { header: item.lastPlayed ? `Last played ${relativeTime(item.lastPlayed)}` : 'Not played yet' },
    ]);
  };

  root.addEventListener('click', onClick);
  root.addEventListener('contextmenu', onContextMenu);
  draw();
  const off = store.on(['instances', 'instancesLoaded', 'loadErrors', 'refreshingData', 'accounts', 'running', 'runningCounts', 'launching', 'settings', 'orbitInstalling'], draw);
  return () => {
    disposeNews();
    off();
    root.removeEventListener('click', onClick);
    root.removeEventListener('contextmenu', onContextMenu);
  };
}
