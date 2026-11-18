// Single source of truth for the tracked games. Imported by background.js and popup.js.
// (Content scripts can't import ES modules, so they hardcode their own gameId string,
// which must match an `id` here.)

// `tag` is an optional little badge shown next to the name in the popup.
export const GAMES = [
  { id: 'wordle',      name: 'Wordle',        source: 'NYT Games',  glyph: 'W', color: '#6aaa64', url: 'https://www.nytimes.com/games/wordle/index.html' },
  { id: 'connections', name: 'Connections',   source: 'NYT Games',  glyph: 'C', color: '#a65bbd', url: 'https://www.nytimes.com/games/connections' },
  { id: 'strands',     name: 'Strands',       source: 'NYT Games',  glyph: 'S', color: '#d6a62a', tag: 'NYT', url: 'https://www.nytimes.com/games/strands' },
  { id: 'globle',      name: 'Globle',        source: 'globle-game.com', glyph: 'G', color: '#14946f', tag: 'GEO', url: 'https://globle-game.com/' },
  { id: 'worldle',     name: 'Worldle',       source: 'teuteuf.fr', glyph: 'Wo', color: '#f0862a', url: 'https://worldle.teuteuf.fr/' },
  { id: 'krillion',    name: 'Krillion',      source: 'krillion.io', glyph: 'K', color: '#e0405f', url: 'https://krillion.io/' },
];

export const GAME_IDS = new Set(GAMES.map((g) => g.id));

export const STATE_KEY = 'dailyState';

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD (daily games roll over at local midnight). */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Next local midnight (plus a 1s cushion so the date has definitely rolled). */
export function nextMidnight(from = new Date()) {
  const d = new Date(from);
  d.setHours(24, 0, 1, 0);
  return d;
}

/**
 * Shape stored in chrome.storage.local under STATE_KEY:
 * { date: 'YYYY-MM-DD', games: { [id]: { completed, result, at, source } } }
 */
export function emptyState() {
  return { date: todayISO(), games: {} };
}

/** Returns the state if it belongs to today, otherwise a blank one. */
export function freshOrEmpty(state) {
  return state && state.date === todayISO() ? state : emptyState();
}

// ---- Per-user list preferences (chrome.storage.sync, so they follow the user's Chrome) ----
// { order: [gameId, ...], hidden: [gameId, ...] }
export const PREFS_KEY = 'prefs';

/** Clean up stored prefs: drop unknown ids, append games added in later versions. */
export function normalizePrefs(prefs) {
  const known = (ids) => [...new Set((Array.isArray(ids) ? ids : []).filter((id) => GAME_IDS.has(id)))];
  const order = known(prefs?.order);
  for (const g of GAMES) if (!order.includes(g.id)) order.push(g.id);
  let hidden = known(prefs?.hidden);
  if (hidden.length >= GAMES.length) hidden = hidden.slice(0, GAMES.length - 1); // keep at least one game
  return { order, hidden };
}

const BY_ID = Object.fromEntries(GAMES.map((g) => [g.id, g]));

/** Every game in the user's order (hidden ones included). */
export function orderedGames(prefs) {
  return normalizePrefs(prefs).order.map((id) => BY_ID[id]);
}

/** The games the user tracks, in their order. */
export function visibleGames(prefs) {
  const p = normalizePrefs(prefs);
  return p.order.filter((id) => !p.hidden.includes(id)).map((id) => BY_ID[id]);
}
