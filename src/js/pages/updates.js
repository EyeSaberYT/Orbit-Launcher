// Orbit Updates: every Orbit announcement and the release notes of the launcher and Orbit Client, as
// full posts. A post opens in a popup inside the launcher (rendered by markdown.js); GitHub keeps the
// original, one click away.
import { system } from '../api.js';
import { mountMarkdown } from '../markdown.js';
import { loadNews, NEWS_URL } from '../news.js';
import { isTauri } from '../tauri.js';
import { html, icon, openModal, setHtml, toastError } from '../ui.js';

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const FILTERS = ['All', 'News', 'Launcher', 'Orbit Client'];
const SEEN_KEY = 'orbit.updates.seen';

const kindIcon = (kind) => (kind === 'News' ? 'sparkles' : kind === 'Orbit Client' ? 'package' : 'download');

/** Remember the newest post the player has seen, so the Updates tab can show a dot for newer ones. */
export function markUpdatesSeen(entries) {
  const newest = entries?.[0]?.date;
  if (!newest) return;
  try { localStorage.setItem(SEEN_KEY, newest); } catch { /* Only the dot depends on it. */ }
  window.dispatchEvent(new CustomEvent('orbit:updates-seen'));
}

export function hasUnseenUpdates(entries) {
  let seen = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch { /* Treat as unseen. */ }
  return Boolean(entries?.[0]?.date) && (!seen || Date.parse(entries[0].date) > Date.parse(seen));
}

const openExternal = (url) => (isTauri ? system.openUrl(url).catch(toastError) : window.open(url, '_blank', 'noopener'));

/** One post, in full, in a popup. */
export function openArticle(story) {
  const modal = openModal({
    ariaLabel: story.title,
    size: 'lg',
    body: html`
      <article class="article">
        <div class="article-cover ${story.image ? '' : 'is-plain'}" data-kind="${story.kind}">
          ${story.image ? html`<img src="${story.image}" alt="" decoding="async" />` : html`<span class="article-cover-mark">${icon(kindIcon(story.kind))}</span>`}
          <button class="article-close" data-close aria-label="Close">${icon('x')}</button>
        </div>
        <header class="article-head">
          <div class="update-meta"><span class="update-kind" data-kind="${story.kind}">${icon(kindIcon(story.kind), 'icon-sm')} ${story.kind}</span><time datetime="${story.date}">${dateFormat.format(new Date(story.date))}</time>${story.tag && html`<span class="update-tag">${story.tag}</span>`}</div>
          <h2>${story.title}</h2>
        </header>
        <div class="article-body" data-body>
          <div class="skeleton-lines" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
        </div>
      </article>`,
    footer: html`<button class="btn btn-ghost" data-github>${icon('external', 'icon-sm')} View on GitHub</button><button class="btn btn-primary" data-close>Done</button>`,
  });
  modal.root.classList.add('article-modal');
  modal.root.querySelector('.article-cover img')?.addEventListener('error', (event) => {
    event.target.closest('.article-cover').classList.add('is-plain');
    event.target.remove();
  }, { once: true });
  modal.root.addEventListener('click', (event) => {
    if (event.target.closest('[data-github]')) openExternal(story.url);
  });
  const body = modal.root.querySelector('[data-body]');
  const source = story.body?.trim() || story.summary || 'This post has no text yet.';
  mountMarkdown(body, source, { isStale: () => modal.closed })
    .then((shown) => shown && body.classList.add('is-ready'))
    .catch(() => setHtml(body, html`<p>${story.summary || 'This post couldn’t be shown here.'}</p>`));
  return modal;
}

export function render(root) {
  root.classList.add('page-updates');
  let filter = 'All';
  let result = null;
  let loading = false;
  let failed = false;
  let disposed = false;

  const card = (story, index) => html`
    <button class="update-card glass ${index === 0 ? 'is-featured' : ''}" data-open="${story.url}" style="--i:${index}">
      <span class="update-cover ${story.image ? '' : 'is-plain'}" data-kind="${story.kind}">
        ${story.image ? html`<img src="${story.image}" alt="" loading="lazy" decoding="async" data-cover />` : html`<span class="update-cover-mark">${icon(kindIcon(story.kind))}</span>`}
      </span>
      <span class="update-copy">
        <span class="update-meta"><span class="update-kind" data-kind="${story.kind}">${icon(kindIcon(story.kind), 'icon-sm')} ${story.kind}</span><time datetime="${story.date}">${dateFormat.format(new Date(story.date))}</time></span>
        <b class="update-title">${story.title}</b>
        ${story.summary && html`<span class="update-summary">${story.summary}</span>`}
        <span class="update-read">Read ${index === 0 ? 'the full post' : 'more'} ${icon('arrow-right', 'icon-sm')}</span>
      </span>
    </button>`;

  const skeleton = () => html`<div class="updates-grid is-loading" aria-hidden="true">${[0, 1, 2, 3, 4].map((i) => html`
    <div class="update-card glass ${i === 0 ? 'is-featured' : ''}"><span class="update-cover skeleton"></span><span class="update-copy"><span class="skeleton-lines"><span></span><span></span><span></span></span></span></div>`)}</div>`;

  function draw() {
    const all = result?.entries ?? [];
    const shown = filter === 'All' ? all : all.filter((story) => story.kind === filter);
    setHtml(root, html`
      <section class="updates-top glass">
      <header class="updates-head">
        <div>
          <h1>Orbit Updates</h1>
          <p>News from the Orbit team, and everything new in the launcher and Orbit Client.</p>
        </div>
        <div class="updates-actions">
          <button class="btn btn-ghost btn-sm" data-all>${icon('external', 'icon-sm')} GitHub</button>
          <button class="btn btn-icon btn-outline ${loading ? 'is-spinning' : ''}" data-refresh aria-label="Check for new posts" data-tip="Check for new posts" ${loading ? 'aria-disabled="true"' : ''}>${icon('refresh')}</button>
        </div>
      </header>
      <div class="segmented updates-filter" role="group" aria-label="Show">
        ${FILTERS.map((name) => html`<button aria-pressed="${filter === name}" data-filter="${name}">${name}${name !== 'All' && result && html`<span>${all.filter((s) => s.kind === name).length}</span>`}</button>`)}
      </div>
      ${result?.offline && html`<p class="updates-note">${icon('wifi-off', 'icon-sm')} Offline. Showing the posts saved on ${dateFormat.format(new Date(result.fetchedAt))}.</p>`}
      </section>
      ${!result && loading ? skeleton()
        : shown.length ? html`<div class="updates-grid">${shown.map(card)}</div>`
        : html`<div class="updates-empty glass">${icon(failed ? 'wifi-off' : 'sparkles')}<b>${failed ? 'Couldn’t reach Orbit Updates' : 'Nothing here yet'}</b><span>${failed ? 'Posts will be back when you’re connected.' : 'New posts from the Orbit team show up here.'}</span>${failed && html`<button class="btn btn-outline btn-sm" data-refresh>${icon('refresh', 'icon-sm')} Try again</button>`}</div>`}`);
    for (const image of root.querySelectorAll('[data-cover]')) {
      const fail = () => { image.parentElement.classList.add('is-plain'); image.remove(); };
      image.addEventListener('error', fail, { once: true });
      if (image.complete && !image.naturalWidth) fail();
    }
  }

  async function refresh(force = false) {
    if (loading) return;
    loading = true;
    failed = false;
    draw();
    try {
      result = await loadNews({ force });
      markUpdatesSeen(result.entries);
    } catch {
      failed = true;
    } finally {
      loading = false;
      if (!disposed) draw();
    }
  }

  const onClick = (event) => {
    const target = event.target;
    if (target.closest('[data-refresh]')) return refresh(true);
    if (target.closest('[data-all]')) return openExternal(NEWS_URL);
    const tab = target.closest('[data-filter]');
    if (tab) {
      filter = tab.dataset.filter;
      draw();
      root.querySelector('.updates-grid')?.classList.add('is-refiltered');
      return;
    }
    const open = target.closest('[data-open]');
    const story = open && result?.entries.find((entry) => entry.url === open.dataset.open);
    if (story) openArticle(story);
  };

  root.addEventListener('click', onClick);
  void refresh();
  return () => {
    disposed = true;
    root.removeEventListener('click', onClick);
  };
}
