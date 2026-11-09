import { system } from '../api.js';
import { loadNews, NEWS_URL } from '../news.js';
import { isTauri } from '../tauri.js';
import { html, icon, setHtml, toastError } from '../ui.js';

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function mountNewsFeed(root) {
  let disposed = false;
  let loading = false;
  let result;
  let failed = false;

  function draw() {
    const restoreRefreshFocus = root.contains(document.activeElement) && document.activeElement.matches('[data-refresh-news]');
    const stories = result?.entries.slice(0, 3) ?? [];
    setHtml(root, html`
      <header class="home-news-head">
        <div><h2 id="home-news-heading">Orbit news</h2><p>From the Orbit team</p></div>
        <button class="home-round-btn" data-refresh-news aria-label="Refresh Orbit news" aria-disabled="${loading ? 'true' : 'false'}">${icon('refresh', 'icon-sm')}</button>
      </header>
      <p class="home-news-status" role="status">${loading ? 'Checking for updates…' : failed ? 'Couldn’t load the news. Try refreshing.' : result?.offline ? `Offline · Saved ${dateFormat.format(new Date(result.fetchedAt))}` : ''}</p>
      <div class="home-news-list" aria-busy="${loading ? 'true' : 'false'}">
        ${stories.length ? stories.map((story, index) => html`
          <a class="home-news-story ${index === 0 ? 'is-featured' : ''}" href="${story.url}" target="_blank" rel="noopener noreferrer" aria-label="${story.title}, opens in your browser">
            ${story.image && html`<img src="${story.image}" alt="" loading="eager" decoding="async" data-news-image />`}
            <div class="home-news-copy"><div class="home-news-meta"><span>${story.kind}</span><time datetime="${story.date}">${dateFormat.format(new Date(story.date))}</time></div><h3>${story.title}</h3>${story.summary && html`<p>${story.summary}</p>`}</div>
            ${icon('external', 'icon-sm')}
          </a>`)
          : loading ? html`<div class="home-news-loading" aria-hidden="true">${[0, 1, 2].map(() => html`
              <div class="home-news-loading-row"><span></span><span></span><span></span><span></span></div>`)
            }</div>`
          : html`<div class="home-news-empty"><span>${failed ? 'News will be back when you’re connected.' : 'No Orbit announcements yet.'}</span>${failed && html`<button class="home-text-btn" data-refresh-news>${icon('refresh', 'icon-sm')} Try again</button>`}</div>`}
      </div>
      <a class="home-library-link home-news-more" href="${NEWS_URL}" target="_blank" rel="noopener noreferrer">All Orbit updates ${icon('arrow-right', 'icon-sm')}</a>`);
    if (restoreRefreshFocus) root.querySelector('[data-refresh-news]').focus({ preventScroll: true });
    for (const image of root.querySelectorAll('[data-news-image]')) {
      const fail = () => { image.closest('a')?.classList.add('without-image'); image.remove(); };
      image.addEventListener('error', fail, { once: true });
      if (image.complete && !image.naturalWidth) fail();
    }
  }

  async function refresh(force = false) {
    if (loading) return;
    loading = true;
    failed = false;
    draw();
    try { result = await loadNews({ force }); }
    catch { failed = true; }
    finally { loading = false; if (!disposed) draw(); }
  }

  const onClick = event => {
    if (event.target.closest('[data-refresh-news]')) return refresh(true);
    const link = event.target.closest('a[href]');
    if (link && isTauri && !event.defaultPrevented && event.button === 0) {
      event.preventDefault();
      system.openUrl(link.href).catch(toastError);
    }
  };
  root.addEventListener('click', onClick);
  void refresh();
  return () => { disposed = true; root.removeEventListener('click', onClick); };
}
