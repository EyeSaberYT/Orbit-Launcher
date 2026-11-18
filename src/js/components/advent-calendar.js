// The Play page's right-hand panel: the advent calendar from November to December, and the newest Orbit
// update for the rest of the year.
import { ADVENT, adventNow, adventPreview, adventSeason, adventToday, christmasAt, claimAdventDay, loadAdventClaims } from '../advent.js';
import { loadNews } from '../news.js';
import { openArticle } from '../pages/updates.js';
import { motionReduced } from '../motion.js';
import { errorText } from '../tauri.js';
import { html, icon, openModal, setHtml, toast } from '../ui.js';

const longDate = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', timeZone: 'UTC' });
const pad = (n) => String(n).padStart(2, '0');

/** The cosmetic's picture, exported from Orbit Client's own model (assets/festive/advent/<id>.png). */
export const sprite = (day, extra = '') => html`<img class="advent-sprite ${extra}" src="assets/festive/advent/${ADVENT[day - 1].id}.png" alt="" aria-hidden="true" draggable="false" />`;

function countdown(now) {
  const left = Math.max(0, christmasAt(now) - now);
  const days = Math.floor(left / 86400000);
  const hours = Math.floor(left / 3600000) % 24;
  const minutes = Math.floor(left / 60000) % 60;
  const seconds = Math.floor(left / 1000) % 60;
  return { days, clock: `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` };
}

/** What a door is: 'today', 'claimed', 'missed' (a past day not claimed) or 'locked' (still to come). */
function doorState(day, today, claimed, season) {
  if (claimed.has(day)) return 'claimed';
  if (season === 'christmas' || (today && day < today)) return 'missed';
  if (day === today) return 'today';
  return 'locked';
}

function openDoor(entry, state, claims, onClaimed) {
  const revealed = state === 'claimed' || state === 'missed' || state === 'today';
  const modal = openModal({
    ariaLabel: `Day ${entry.day}: ${revealed ? entry.name : 'a surprise'}`,
    size: 'sm',
    body: html`
      <div class="advent-door is-${state}">
        <div class="advent-door-stage">
          <span class="advent-door-glow" aria-hidden="true"></span>
          ${state === 'today' ? html`<span class="advent-gift" data-gift aria-hidden="true">${icon('gift')}</span>` : ''}
          ${sprite(entry.day, `is-large ${revealed ? '' : 'is-hidden'} ${state === 'today' ? 'is-wrapped' : ''}`)}
        </div>
        <span class="advent-door-day">December ${entry.day}</span>
        <h2>${revealed && state !== 'today' ? entry.name : state === 'today' ? 'Today’s gift' : 'A surprise'}</h2>
        <p class="advent-door-type" data-type>${revealed && state !== 'today' ? `${entry.type} · Limited edition` : state === 'today' ? 'Unwrap it to see what it is' : `Unwraps on December ${entry.day}`}</p>
        <p class="advent-door-blurb" data-blurb ${state === 'today' || !revealed ? 'hidden' : ''}>${entry.blurb}</p>
        <div class="advent-door-actions" data-actions>
          ${state === 'today' ? html`<button class="btn btn-primary advent-unwrap" data-unwrap>${icon('gift', 'icon-sm')} Unwrap</button>`
            : state === 'claimed' ? html`<span class="advent-owned">${icon('check-circle', 'icon-sm')} In your wardrobe</span>`
            : state === 'missed' ? html`<span class="advent-missed">This one was only available on December ${entry.day}.</span>`
            : html`<span class="advent-missed">${icon('lock', 'icon-sm')} Come back on December ${entry.day}</span>`}
        </div>
      </div>`,
  });
  modal.root.classList.add('advent-modal');

  const claimRow = () => (claims.available
    ? html`<button class="btn btn-primary" data-claim>${icon('sparkles', 'icon-sm')} Claim for Orbit Client</button>
      <span class="advent-note">It goes straight into your Orbit Client wardrobe.</span>`
    : html`<button class="btn btn-primary" disabled>${icon('sparkles', 'icon-sm')} Claim for Orbit Client</button>
      <span class="advent-note">${claims.preview ? 'Preview: claiming is turned off.' : 'Sign in with your Minecraft account, then open this door again to claim it.'}</span>`);

  modal.root.addEventListener('click', (event) => {
    if (event.target.closest('[data-unwrap]')) {
      const door = modal.root.querySelector('.advent-door');
      const reveal = () => {
        door.classList.add('is-unwrapped');
        modal.root.querySelector('h2').textContent = entry.name;
        modal.root.querySelector('[data-type]').textContent = `${entry.type} · Limited edition · Today only`;
        modal.root.querySelector('[data-blurb]').hidden = false;
        setHtml(modal.root.querySelector('[data-actions]'), claimRow());
      };
      if (motionReduced()) reveal();
      else {
        door.classList.add('is-shaking');
        setTimeout(reveal, 620);
      }
    }
    const claim = event.target.closest('[data-claim]');
    if (claim && onClaimed) {
      claim.disabled = true;
      setHtml(claim, html`${icon('sparkles', 'icon-sm')} Claiming…`);
      onClaimed(entry.day).then(
        () => setHtml(modal.root.querySelector('[data-actions]'), html`<span class="advent-owned">${icon('check-circle', 'icon-sm')} In your wardrobe</span><span class="advent-note">Open the wardrobe in Orbit Client and press Refresh to wear it.</span>`),
        (error) => {
          claim.disabled = false;
          setHtml(claim, html`${icon('sparkles', 'icon-sm')} Claim for Orbit Client`);
          toast("Couldn't claim this door", { kind: 'error', description: errorText(error) });
        },
      );
    }
  });
}

export function mountAdventCalendar(root) {
  let disposed = false;
  let claims = { claimed: new Set(), available: false, preview: adventPreview };
  let timer = 0;
  let drawnSeason = null;

  function drawAdvent() {
    const now = adventNow();
    const season = adventSeason(now);
    const today = adventToday(now);
    const { days, clock } = countdown(now);
    const owned = claims.claimed.size;
    setHtml(root, html`
      <header class="advent-head">
        <div>
          <h2 id="home-side-heading">${icon('snowflake', 'icon-sm')} Advent calendar</h2>
          <p>A limited-edition cosmetic every day until Christmas</p>
        </div>
        ${season !== 'countdown' && html`<span class="advent-count" data-tip="Cosmetics you’ve claimed">${icon('gift', 'icon-sm')} ${owned}/24</span>`}
      </header>
      <div class="advent-countdown" role="timer" aria-live="off">
        ${season === 'christmas'
          ? html`<b class="advent-merry">Merry Christmas!</b><span>Thanks for playing with Orbit this year.</span>`
          : html`<span class="advent-days"><b data-days>${days}</b><small>${days === 1 ? 'day' : 'days'}</small></span><span class="advent-clock"><b data-clock>${clock}</b><small>until Christmas</small></span>`}
      </div>
      <div class="advent-grid" role="list">
        ${ADVENT.map((entry) => {
          const state = doorState(entry.day, today, claims.claimed, season);
          return html`<button role="listitem" class="advent-tile is-${state}" data-door="${entry.day}" style="--d:${entry.day}" aria-label="December ${entry.day}${state === 'claimed' ? `, ${entry.name}, claimed` : state === 'today' ? ', open today' : state === 'missed' ? ', missed' : ', locked'}">
            <span class="advent-num">${entry.day}</span>
            ${state === 'claimed' || state === 'missed' ? sprite(entry.day) : state === 'today' ? html`<span class="advent-today-mark">${icon('gift')}</span>` : ''}
          </button>`;
        })}
      </div>
      <footer class="advent-foot">
        ${season === 'countdown'
          ? html`<span>${icon('lock', 'icon-sm')} The first door opens on December 1</span>`
          : today ? html`<span>${icon('sparkles', 'icon-sm')} Door ${today} is open: tap it to unwrap</span>`
          : html`<span>${icon('star', 'icon-sm')} See you next December</span>`}
        <a class="home-text-btn" href="#/updates">Orbit Updates ${icon('arrow-right', 'icon-sm')}</a>
      </footer>`);
  }

  // Only the numbers change every second; the doors are redrawn when the day does.
  let drawnDay = null;
  function tick() {
    const now = adventNow();
    const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    if (day !== drawnDay || adventSeason(now) !== drawnSeason) {
      drawnDay = day;
      drawnSeason = adventSeason(now);
      if (drawnSeason === 'off') return drawLatest();
      root.classList.add('home-advent');
      drawAdvent();
      return;
    }
    const { days, clock } = countdown(now);
    const daysEl = root.querySelector('[data-days]');
    const clockEl = root.querySelector('[data-clock]');
    if (daysEl && daysEl.textContent !== String(days)) daysEl.textContent = days;
    if (clockEl) clockEl.textContent = clock;
  }

  // The rest of the year: the newest post from Orbit Updates.
  async function drawLatest() {
    root.classList.remove('home-advent');
    root.classList.add('home-latest');
    setHtml(root, html`<header class="advent-head"><div><h2 id="home-side-heading">${icon('newspaper', 'icon-sm')} Latest from Orbit</h2><p>News and updates from the Orbit team</p></div></header><div class="skeleton-lines" aria-hidden="true"><span></span><span></span><span></span></div>`);
    let story = null;
    try { story = (await loadNews()).entries[0] ?? null; } catch { /* Shown as offline below. */ }
    if (disposed) return;
    setHtml(root, html`
      <header class="advent-head"><div><h2 id="home-side-heading">${icon('newspaper', 'icon-sm')} Latest from Orbit</h2><p>News and updates from the Orbit team</p></div></header>
      ${story ? html`<button class="latest-story" data-latest>${story.image && html`<img src="${story.image}" alt="" decoding="async" />`}<span class="update-meta"><span class="update-kind" data-kind="${story.kind}">${story.kind}</span><time>${longDate.format(new Date(story.date))}</time></span><b>${story.title}</b>${story.summary && html`<span>${story.summary}</span>`}</button>`
        : html`<p class="advent-note">Orbit Updates will show here when you’re connected.</p>`}
      <footer class="advent-foot"><span></span><a class="home-text-btn" href="#/updates">All Orbit updates ${icon('arrow-right', 'icon-sm')}</a></footer>`);
    root.querySelector('[data-latest]')?.addEventListener('click', () => openArticle(story));
    root.querySelector('.latest-story img')?.addEventListener('error', (event) => event.target.remove(), { once: true });
  }

  const onClick = (event) => {
    const tile = event.target.closest('[data-door]');
    if (!tile) return;
    const now = adventNow();
    const entry = ADVENT[Number(tile.dataset.door) - 1];
    openDoor(entry, doorState(entry.day, adventToday(now), claims.claimed, adventSeason(now)), claims, async (day) => {
      claims = await claimAdventDay(day);
      drawnDay = null;
      tick();
    });
  };

  root.addEventListener('click', onClick);
  tick();
  timer = setInterval(tick, 1000);
  loadAdventClaims().then((result) => {
    if (disposed) return;
    claims = result;
    drawnDay = null;
    tick();
  });
  return () => {
    disposed = true;
    clearInterval(timer);
    root.removeEventListener('click', onClick);
  };
}
