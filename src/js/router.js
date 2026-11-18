// Hash router. Routes map a pattern to a page module exposing
//   export function render(root, params, query) -> optional cleanup()
// where `root` is an empty <div class="page"> inside the scrolling view.
//
// Routes:
//   #/                                   home
//   #/library                            instance library
//   #/instance/:id/:tab?                 instance detail (tab: content|worlds|screenshots|servers|console|settings)
//   #/discover/:type?                    browse Modrinth / CurseForge (?q=&source=&instance=)
//   #/project/:source/:id                project page (source: modrinth | curseforge; ?instance=)
//   #/settings/:section?                 settings
//   #/friends                            friends and chats (?chat=<uuid> opens one)
import { enterPage, leaveDuration, leavePage } from './motion.js';

const routes = [];
let current = { cleanup: null, token: 0, route: null, params: null };

export function route(pattern, load) {
  const names = [];
  // Switching only the last, optional part (an instance's tab, a settings section) is a quick change.
  const tabbed = /\/:\w+\?$/.test(pattern);
  const regex = new RegExp(
    '^' +
      pattern.replace(/\/:(\w+)(\?)?/g, (_, name, optional) => {
        names.push(name);
        return optional ? '(?:/([^/]+))?' : '/([^/]+)';
      }) +
      '/?$',
  );
  routes.push({ regex, names, load, tabbed });
}

/** Navigate to a hash path such as `/instance/abc/content`. */
export function navigate(path, { replace = false } = {}) {
  const hash = `#${path.startsWith('/') ? path : `/${path}`}`;
  if (replace) {
    history.replaceState(null, '', hash);
    resolve();
  } else if (location.hash === hash) {
    resolve();
  } else {
    location.hash = hash;
  }
}

/** The current path and query, e.g. { path: '/discover/mod', query: URLSearchParams }. */
export function currentRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(search) };
}

const listeners = new Set();
/** Called with the path after each navigation (used by the rail and top bar). */
export function onNavigate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let crumb = null;
const crumbListeners = new Set();

/** Name the current page in the top bar's breadcrumb, e.g. a project's title. Cleared on navigation. */
export function setCrumb(label) {
  crumb = label || null;
  crumbListeners.forEach((fn) => fn(crumb));
}

export const currentCrumb = () => crumb;

export function onCrumb(fn) {
  crumbListeners.add(fn);
  return () => crumbListeners.delete(fn);
}

async function resolve() {
  const { path, query } = currentRoute();
  const token = ++current.token;

  let match = null;
  let params = {};
  for (const candidate of routes) {
    const result = candidate.regex.exec(path);
    if (result) {
      match = candidate;
      candidate.names.forEach((name, index) => {
        const value = result[index + 1];
        if (value === undefined) return;
        try {
          params[name] = decodeURIComponent(value);
        } catch {
          match = null; // A malformed escape such as %E0 is not a valid route.
        }
      });
      break;
    }
  }

  try {
    current.cleanup?.();
  } catch (error) {
    console.error('page cleanup failed', error);
  }
  current.cleanup = null;

  crumb = null;
  listeners.forEach((fn) => fn(path));

  const view = document.getElementById('view');
  const quick = !!match && match === current.route && match.tabbed &&
    match.names.slice(0, -1).every((name) => params[name] === current.params?.[name]);
  current.route = match;
  current.params = params;
  const root = document.createElement('div');
  root.className = 'page';
  root.setAttribute('aria-busy', 'true');
  // The page on screen fades out where it stands while the new one fades in; one that never finished
  // opening just goes.
  let leaving = false;
  // Everything in the view goes: the last page, or the startup card on first open.
  for (const old of [...view.children]) {
    if (old.classList.contains('is-leaving')) continue;
    if (old.matches('.page[aria-busy]')) old.remove();
    else {
      leavePage(old, view, { quick });
      leaving = true;
    }
  }
  if (leaving) root.style.visibility = 'hidden';
  view.append(root);
  view.scrollTop = 0;
  // The new page comes in as the old one finishes fading (never on top of it), once it is ready; a page
  // that is slow to open shows its loading state shortly after.
  let entered = !leaving;
  const earliest = performance.now() + leaveDuration(quick) * 0.9;
  const enter = () => {
    if (entered || token !== current.token) return;
    const wait = earliest - performance.now();
    if (wait > 0) {
      setTimeout(enter, wait);
      return;
    }
    entered = true;
    enterPage(root, { quick });
  };
  if (leaving) setTimeout(enter, 450);

  if (!match) {
    root.removeAttribute('aria-busy');
    root.innerHTML = '<div class="empty"><h1>Page not found</h1><p><a href="#/">Go home</a></p></div>';
    enter();
    return;
  }

  const loading = document.createElement('div');
  loading.className = 'loading-block';
  loading.setAttribute('role', 'status');
  loading.innerHTML = '<span class="spinner" aria-hidden="true"></span><h1>Opening view</h1>';
  root.append(loading);
  try {
    const page = await match.load();
    if (token !== current.token) return;
    loading.remove();
    const cleanup = await page.render(root, params, query);
    if (token !== current.token) {
      cleanup?.();
      return;
    }
    current.cleanup = typeof cleanup === 'function' ? cleanup : null;
    root.removeAttribute('aria-busy');
    enter();
  } catch (error) {
    console.error(error);
    if (token === current.token) {
      root.removeAttribute('aria-busy');
      root.innerHTML = `<div class="empty"><h1>View unavailable</h1><p class="selectable">${String(error?.message ?? error)
        .replace(/</g, '&lt;')}</p></div>`;
      enter();
    }
  }
}

export function startRouter() {
  window.addEventListener('hashchange', resolve);
  return resolve();
}
