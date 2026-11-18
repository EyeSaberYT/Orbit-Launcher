// The Christmas advent calendar on the Play page: one limited-edition Orbit Client cosmetic for each day
// from December 1st to 24th. The pictures (assets/festive/advent/<id>.png) are exported from Orbit Client's
// own models, so they show exactly what you'll wear.
//
// Ownership lives on the Orbit cosmetics server, never in the launcher: a door counts as claimed only when the
// server says so, and the server only accepts a door while it's that date somewhere on Earth.
import { advent as adventApi } from './api.js';

export const ADVENT = [
  { day: 1, id: 'xmas_santa_hat', name: 'Santa Hat', type: 'Hat', blurb: 'The classic. Red, fluffy, and ready for the first snow.' },
  { day: 2, id: 'xmas_candy_cane', name: 'Candy Cane', type: 'Back', blurb: 'A big striped cane worn across your back. Not for eating.' },
  { day: 3, id: 'xmas_snowflake_halo', name: 'Snowflake Halo', type: 'Hat', blurb: 'A snowflake of ice turning slowly above your head.' },
  { day: 4, id: 'xmas_gingerbread', name: 'Gingerbread Buddy', type: 'Pet', blurb: 'A gingerbread friend with gumdrop buttons who follows you around.' },
  { day: 5, id: 'xmas_reindeer_nose', name: 'Reindeer Nose', type: 'Face', blurb: 'A shiny red nose that glows. Very bright.' },
  { day: 6, id: 'xmas_holly_crown', name: 'Holly Crown', type: 'Hat', blurb: 'Holly leaves and red berries, woven into a crown.' },
  { day: 7, id: 'xmas_gift_pack', name: 'Gift Backpack', type: 'Back', blurb: 'A wrapped present with a gold bow, worn like a backpack.' },
  { day: 8, id: 'xmas_wreath', name: 'Wreath', type: 'Back', blurb: 'An evergreen wreath with berries and a red bow.' },
  { day: 9, id: 'xmas_tree_topper', name: 'Tree Topper', type: 'Hat', blurb: 'A little Christmas tree on your head, baubles and star and all.' },
  { day: 10, id: 'xmas_snowman', name: 'Mini Snowman', type: 'Pet', blurb: 'A snowman in a top hat who never melts.' },
  { day: 11, id: 'xmas_snow_goggles', name: 'Snow Goggles', type: 'Face', blurb: 'Ski goggles with icy blue lenses.' },
  { day: 12, id: 'xmas_stocking', name: 'Stocking', type: 'Back', blurb: 'A Christmas stocking hung on your back, presents peeking out.' },
  { day: 13, id: 'xmas_bauble', name: 'Bauble', type: 'Pet', blurb: 'A violet ornament with a gold band, turning beside you.' },
  { day: 14, id: 'xmas_antlers', name: 'Reindeer Antlers', type: 'Hat', blurb: 'For when you want to pull the sleigh yourself.' },
  { day: 15, id: 'xmas_peppermints', name: 'Peppermint Orbit', type: 'Aura', blurb: 'Peppermint sweets circling your waist.' },
  { day: 16, id: 'xmas_ice_crown', name: 'Ice Crown', type: 'Hat', blurb: 'A crown of ice spikes, glowing faintly.' },
  { day: 17, id: 'xmas_frost_wings', name: 'Frost Wings', type: 'Wings', blurb: 'Wings of ice shards that catch the light.' },
  { day: 18, id: 'xmas_festive_cape', name: 'Festive Cape', type: 'Cape', blurb: 'Red velvet with white fur trim, a gold star and falling snow.' },
  { day: 19, id: 'xmas_north_star', name: 'North Star', type: 'Hat', blurb: 'A golden star floating above you to guide the way home.' },
  { day: 20, id: 'xmas_scarf', name: 'Knitted Scarf', type: 'Face', blurb: 'Red, white and green stripes, one end hanging down.' },
  { day: 21, id: 'xmas_cookies', name: 'Cookie Crumbs', type: 'Aura', blurb: 'Cookies floating up around you.' },
  { day: 22, id: 'xmas_elf_hat', name: 'Elf Hat', type: 'Hat', blurb: 'Pointy, green and very official, with a bell on the tip.' },
  { day: 23, id: 'xmas_snow_globe', name: 'Snow Globe', type: 'Pet', blurb: 'A little winter world that floats along with you.' },
  { day: 24, id: 'xmas_star_aura', name: 'Christmas Star Aura', type: 'Aura', blurb: 'Golden stars circling you, for Christmas Eve only.' },
];

/**
 * Where the calendar is in the year, on the local clock:
 * 'countdown' in November (all doors closed), 'open' from December 1st to 24th, 'christmas' from the 25th
 * to the 31st, and 'off' the rest of the year (the Play page then shows the latest Orbit update instead).
 */
export function adventSeason(now = adventNow()) {
  const month = now.getMonth();
  if (month === 10) return 'countdown';
  if (month !== 11) return 'off';
  return now.getDate() <= 24 ? 'open' : 'christmas';
}

/** Today's door (1 to 24) in December, else null. */
export function adventToday(now = adventNow()) {
  return now.getMonth() === 11 && now.getDate() <= 24 ? now.getDate() : null;
}

/** Midnight at the start of Christmas Day (this year's, or next year's once it has passed). */
export function christmasAt(now = adventNow()) {
  const year = now.getMonth() === 11 && now.getDate() >= 25 ? now.getFullYear() + 1 : now.getFullYear();
  return new Date(year, 11, 25);
}

// ---------- Preview ----------
// To see the calendar part-way through December (screenshots, design checks), with the festive preview on
// (localStorage 'orbit.festive' = 'on'):
//   localStorage.setItem('orbit.advent.preview', JSON.stringify({ date: '2026-12-08T15:00', claimed: [1, 2, 3] }))
// This is display-only test data: it never claims anything, and the Claim button stays disabled.
function preview() {
  try {
    if (localStorage.getItem('orbit.festive') !== 'on') return null;
    const value = JSON.parse(localStorage.getItem('orbit.advent.preview'));
    const date = new Date(value?.date);
    if (!Number.isFinite(date.getTime())) return null;
    const claimed = Array.isArray(value.claimed) ? value.claimed.filter((day) => Number.isInteger(day) && day >= 1 && day <= 24) : [];
    return { offset: date.getTime() - Date.now(), claimed };
  } catch {
    return null;
  }
}
const previewData = preview();
export const adventPreview = Boolean(previewData);

/** The calendar's clock: the real one, or the preview date (still ticking) while previewing. */
export function adventNow() {
  return new Date(Date.now() + (previewData?.offset ?? 0));
}

/**
 * The doors this player has claimed and the ones open right now, from the Orbit server. `available` is false
 * when the server can't be asked (not signed in, offline); `reason` then says why.
 */
export async function loadAdventClaims() {
  if (previewData) return { claimed: new Set(previewData.claimed), open: new Set(), available: false, preview: true };
  try {
    const status = await adventApi.status();
    return { claimed: new Set(status.claimed ?? []), open: new Set(status.open ?? []), available: true, preview: false };
  } catch (error) {
    return { claimed: new Set(), open: new Set(), available: false, preview: false, reason: String(error?.message ?? error) };
  }
}

/** Claim a door on the server; resolves to the new claims, or throws with the server's reason. */
export async function claimAdventDay(day) {
  const status = await adventApi.claim(day);
  return { claimed: new Set(status.claimed ?? []), open: new Set(status.open ?? []), available: true, preview: false };
}
