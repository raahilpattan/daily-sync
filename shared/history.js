// Daily history and streaks. Imported by background.js (writes) and popup.js (reads).
//
// Stored in chrome.storage.local under HISTORY_KEY:
//   { 'YYYY-MM-DD': { tracked: [gameId, ...], games: { [gameId]: { result, summary } } }, ... }
// `tracked` is the list of games the user had visible that day, so "4 of 5" stays right
// even if they change their list later. Kept for HISTORY_DAYS days.

import { GAMES, todayISO } from './games.js';

export const HISTORY_KEY = 'history';
export const HISTORY_DAYS = 400;

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD shifted by `n` days (local calendar, DST-safe). */
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n, 12); // noon avoids DST edge cases
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/** Today's history entry, built from the day state and the games the user tracks. */
export function dayEntry(state, trackedIds) {
  const games = {};
  for (const [id, e] of Object.entries(state?.games || {})) {
    if (e?.completed) games[id] = { result: e.result || 'done', summary: e.detail?.summary || '' };
  }
  return { tracked: [...trackedIds], games };
}

/** Returns a new history object with `date` set to `entry`, pruned to HISTORY_DAYS. */
export function withDay(history, date, entry) {
  const out = { ...(history || {}) };
  if (Object.keys(entry.games).length) out[date] = entry;
  else delete out[date]; // an empty day isn't history (e.g. everything unticked)
  const cutoff = addDays(date, -HISTORY_DAYS);
  for (const d of Object.keys(out)) if (d < cutoff) delete out[d];
  return out;
}

const played = (day, gameId) =>
  gameId ? !!day?.games?.[gameId] : !!day && Object.keys(day.games || {}).length > 0;

/**
 * Streak of consecutive days with at least one puzzle finished (or with `gameId` finished).
 * Today only counts once played; until then the streak runs through yesterday,
 * so it doesn't look broken first thing in the morning.
 */
export function streaks(history, gameId = null, today = todayISO()) {
  const h = history || {};
  let current = 0;
  let d = played(h[today], gameId) ? today : addDays(today, -1);
  while (played(h[d], gameId)) { current++; d = addDays(d, -1); }

  let best = 0, run = 0, prev = null, days = 0;
  for (const date of Object.keys(h).sort()) {
    if (!played(h[date], gameId)) continue;
    days++;
    run = prev && addDays(prev, 1) === date ? run + 1 : 1;
    best = Math.max(best, run);
    prev = date;
  }
  return { current, best: Math.max(best, current), days, playedToday: played(h[today], gameId) };
}

/** Days where every tracked game was finished. */
export function perfectDays(history) {
  return Object.values(history || {}).filter((day) =>
    day.tracked?.length && day.tracked.every((id) => day.games?.[id])).length;
}

/**
 * Turn a result summary into a number we can average.
 * "4/6" → 4 (X/6 → 7), "12 guesses" → 12, "Perfect" → 0 mistakes, "2 hints", "Score 5".
 */
export function parseScore(summary) {
  const s = String(summary || '');
  let m;
  if ((m = s.match(/^([X\d]+)\/(\d+)/))) {
    const max = Number(m[2]);
    return { kind: 'fraction', value: m[1] === 'X' ? max + 1 : Number(m[1]), max };
  }
  if ((m = s.match(/^(\d+) guess/))) return { kind: 'guesses', value: Number(m[1]) };
  if (s === 'Perfect') return { kind: 'mistakes', value: 0 };
  if ((m = s.match(/^(\d+) mistake/))) return { kind: 'mistakes', value: Number(m[1]) };
  if (s === 'No hints') return { kind: 'hints', value: 0 };
  if ((m = s.match(/^(\d+) hint/))) return { kind: 'hints', value: Number(m[1]) };
  if ((m = s.match(/^Score (\d+)/))) return { kind: 'score', value: Number(m[1]) };
  return null;
}

/** "avg 3.9/6", "avg 7.2 guesses", … or '' when there's nothing to average. */
export function averageLabel(history, gameId) {
  const scores = Object.values(history || {})
    .map((day) => parseScore(day.games?.[gameId]?.summary))
    .filter(Boolean);
  if (!scores.length) return '';
  // Use the most common kind, in case a game's format changed at some point.
  const counts = {};
  for (const s of scores) counts[s.kind] = (counts[s.kind] || 0) + 1;
  const kind = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const same = scores.filter((s) => s.kind === kind);
  const avg = (same.reduce((sum, s) => sum + s.value, 0) / same.length).toFixed(1).replace(/\.0$/, '');
  const plural = (word) => `${word}${avg === '1' ? '' : word === 'guess' ? 'es' : 's'}`;
  switch (kind) {
    case 'fraction': return `avg ${avg}/${same[same.length - 1].max}`;
    case 'guesses': return `avg ${avg} ${plural('guess')}`;
    case 'mistakes': return `avg ${avg} ${plural('mistake')}`;
    case 'hints': return `avg ${avg} ${plural('hint')}`;
    default: return `avg score ${avg}`;
  }
}

/**
 * Calendar cells for the last `weeks` weeks, Monday-first, oldest week first.
 * Each cell: { date, done, total, future }.
 */
export function calendar(history, weeks = 15, today = todayISO()) {
  const [y, m, d] = today.split('-').map(Number);
  const dow = (new Date(y, m - 1, d, 12).getDay() + 6) % 7; // 0 = Monday
  const start = addDays(today, -dow - (weeks - 1) * 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    const day = history?.[date];
    const tracked = day?.tracked?.length ? day.tracked : GAMES.map((g) => g.id);
    cells.push({
      date,
      done: day ? tracked.filter((id) => day.games?.[id]).length : 0,
      total: tracked.length,
      future: date > today,
    });
  }
  return cells;
}
