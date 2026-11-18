// Orbit Updates: announcements and release notes from the public GitHub releases of the launcher and
// of Orbit Client. See docs/publishing-news.md. No GitHub token belongs in the launcher.
export const NEWS_REPOSITORY = 'MineArcadeStudio/Orbit-Launcher';
export const CLIENT_REPOSITORY = 'MineArcadeStudio/OrbitClient';
export const NEWS_URL = `https://github.com/${NEWS_REPOSITORY}/releases`;
export const NEWS_ENDPOINT = `https://api.github.com/repos/${NEWS_REPOSITORY}/releases?per_page=20`;
/** Each feed and what its (non-news) releases are called on the Updates page. */
export const FEEDS = [
  { repo: NEWS_REPOSITORY, kind: 'Launcher' },
  { repo: CLIENT_REPOSITORY, kind: 'Orbit Client' },
];
const KINDS = ['News', ...FEEDS.map((feed) => feed.kind)];
const CACHE_KEY = 'orbit.github-news.v2';
const CACHE_AGE = 15 * 60 * 1000;
/** Full posts are shown in the launcher; anything longer than this is cut (GitHub has the rest). */
const BODY_LIMIT = 40000;
let pending;

function trustedUrl(value, image = false) {
  for (const { repo } of FEEDS) {
    const url = trustedRepoUrl(value, repo, image);
    if (url) return url;
  }
  return null;
}

function trustedRepoUrl(value, repository, image) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    const path = url.pathname.toLowerCase();
    const repo = repository.toLowerCase();
    const article = url.hostname === 'github.com' && path.startsWith(`/${repo}/releases/tag/`);
    const picture = (url.hostname === 'raw.githubusercontent.com' && path.startsWith(`/${repo}/`))
      || (url.hostname === 'github.com' && (path.startsWith('/user-attachments/assets/') || path.startsWith(`/${repo}/releases/download/`)))
      || url.hostname === 'user-images.githubusercontent.com';
    return (image ? picture : article) ? url.href : null;
  } catch { return null; }
}

function summaryFromMarkdown(body) {
  if (typeof body !== 'string') return '';
  // A short text excerpt, never remote HTML. The full Markdown stays on GitHub.
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]*>/g, '')
    .split(/\r?\n/).map(line => line.trim());
  const prose = lines.filter(line => line && !/^#{1,6}\s/.test(line)).map(line => line.replace(/^([-*>]|\d+[.)])\s+/, ''));
  return prose.join(' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function coverImage(release) {
  const asset = Array.isArray(release.assets) && release.assets.find(asset => /^news-cover\.(png|jpe?g|webp)$/i.test(asset?.name)
    && /^image\/(png|jpeg|webp)$/.test(asset.content_type));
  const attached = trustedUrl(asset?.browser_download_url, true);
  if (attached) return attached;
  const markdownImage = typeof release.body === 'string' && release.body.match(/!\[[^\]]*\]\(\s*(https:\/\/[^\s)]+)(?:\s+"[^"]*")?\s*\)/);
  return trustedUrl(markdownImage?.[1], true);
}

function validate(entries) {
  const seen = new Set();
  return entries.flatMap((entry) => {
    const url = trustedUrl(entry?.url);
    if (!url || seen.has(url) || typeof entry.title !== 'string' || !entry.title.trim()
      || typeof entry.date !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(entry.date) || !Number.isFinite(Date.parse(entry.date))) return [];
    seen.add(url);
    return [{
      title: entry.title.trim().slice(0, 180), url, date: entry.date,
      summary: typeof entry.summary === 'string' ? entry.summary.trim().slice(0, 240) : '',
      image: trustedUrl(entry.image, true),
      kind: KINDS.includes(entry.kind) ? entry.kind : 'Launcher',
      tag: typeof entry.tag === 'string' ? entry.tag.slice(0, 80) : '',
      // Markdown, rendered and sanitised by markdown.js when the post is opened.
      body: typeof entry.body === 'string' ? entry.body.slice(0, BODY_LIMIT) : '',
    }];
  }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 40);
}

/** GitHub releases of one feed (the launcher's unless `feed` says otherwise) as Orbit Updates posts. */
export function normalizeNews(releases, feed = FEEDS[0]) {
  if (!Array.isArray(releases)) throw new Error('Invalid Orbit news response.');
  return validate(releases.filter(release => release && !release.draft && release.published_at
    && (!release.prerelease || /^news[-/]/i.test(release.tag_name))).map(release => ({
    title: release.name || release.tag_name, date: release.published_at, url: release.html_url,
    summary: summaryFromMarkdown(release.body), image: coverImage(release), tag: release.tag_name,
    kind: /^news[-/]/i.test(release.tag_name) ? 'News' : feed.kind,
    body: release.body,
  })));
}

async function fetchFeed(feed, signal) {
  const response = await fetch(`https://api.github.com/repos/${feed.repo}/releases?per_page=20`, {
    signal, credentials: 'omit', headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error('Orbit news is unavailable.');
  return normalizeNews(await response.json(), feed);
}

function readCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!cached || !Number.isFinite(cached.fetchedAt) || cached.fetchedAt > Date.now() || !Array.isArray(cached.entries)) return null;
    // Empty is cacheable too: an unpublished feed must not hammer GitHub.
    const entries = validate(cached.entries);
    return { entries, fetchedAt: cached.fetchedAt, offline: false };
  } catch { return null; }
}

export function loadNews({ force = false } = {}) {
  if (pending) return pending;
  const cached = readCache();
  if (!force && cached && Date.now() - cached.fetchedAt < CACHE_AGE) return Promise.resolve(cached);
  pending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      // Either feed alone is still worth showing; only both failing counts as offline.
      const feeds = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed, controller.signal)));
      if (feeds.every((feed) => feed.status === 'rejected')) throw feeds[0].reason;
      const entries = validate(feeds.flatMap((feed) => (feed.status === 'fulfilled' ? feed.value : [])));
      const result = { entries, fetchedAt: Date.now(), offline: false };
      // A valid empty response is a real empty state, not a network failure.
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(result)); } catch { /* Private/full storage must not break the feed. */ }
      return result;
    } catch (error) {
      if (cached) return { ...cached, offline: true };
      throw error;
    } finally {
      clearTimeout(timer);
      pending = null;
    }
  })();
  return pending;
}
