import { GAMES, STATE_KEY, todayISO, nextMidnight, freshOrEmpty, emptyState } from './shared/games.js';

const $ = (id) => document.getElementById(id);
const list = $('game-list');
const template = $('row-template');

let state = emptyState();
const rows = new Map(); // gameId -> <li>

// ---------- Illustrated tile art (static, decorative SVG on a 44×44 grid) ----------
const W = 'fill="#fff"';
const D = 'fill="#000"';
const ART = {
  // Grid tiles
  wordle: `<g ${W} opacity=".28"><rect x="26" y="4" width="6" height="6" rx="1.2"/><rect x="33" y="4" width="6" height="6" rx="1.2"/><rect x="33" y="11" width="6" height="6" rx="1.2"/><rect x="5" y="33" width="6" height="6" rx="1.2"/></g>
           <g ${D} opacity=".14"><rect x="26" y="11" width="6" height="6" rx="1.2"/><rect x="5" y="26" width="6" height="6" rx="1.2"/><rect x="12" y="33" width="6" height="6" rx="1.2"/></g>`,
  // Puzzle-piece corners
  connections: `<g ${D} opacity=".2"><path d="M30 0h14v15h-5.2a3.4 3.4 0 1 0-6.6 0H30z"/><path d="M0 30h5.2a3.4 3.4 0 1 1 6.6 0H15v14H0z"/></g>
                <g ${W} opacity=".18"><path d="M44 30v14H30v-5.2a3.4 3.4 0 1 0 0-6.6V30z"/></g>`,
  // Letter grid + winding strand
  strands: `<g ${D} opacity=".35" font-family="Segoe UI, sans-serif" font-weight="700" font-size="7"><text x="5" y="10">W</text><text x="34" y="39">R</text><text x="35" y="10">A</text></g>
            <path d="M6 30c6-8 10 4 16-3s9-11 16-9" fill="none" stroke="#000" stroke-opacity=".22" stroke-width="2.4" stroke-linecap="round"/>`,
  // Crossword squares
  mini: `<g ${W} opacity=".3"><rect x="27" y="3" width="6" height="6"/><rect x="34" y="10" width="6" height="6"/><rect x="4" y="34" width="6" height="6"/><rect x="11" y="27" width="6" height="6"/></g>
         <g ${D} opacity=".18"><rect x="34" y="3" width="6" height="6"/><rect x="27" y="10" width="6" height="6"/><rect x="4" y="27" width="6" height="6"/></g>`,
  // Globe meridians
  globle: `<g fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="1.6"><circle cx="22" cy="22" r="15"/><ellipse cx="22" cy="22" rx="6.5" ry="15"/><path d="M7.5 17h29M7.5 27h29M22 7v30"/></g>`,
  // Continent blobs
  worldle: `<g ${D} opacity=".2"><path d="M4 12c3-5 9-6 12-3s1 7 5 8 3 6-2 7-6-2-9 0-7 1-7-4 0-5 1-8z"/><path d="M28 26c3-2 8-1 10 2s0 8-3 10-6 0-7-3-3-7 0-9z"/><path d="M27 6c2-2 6-2 8 0s1 4-2 5-7-2-6-5z"/></g>`,
  // Pixel bubbles
  krillion: `<g ${W} opacity=".32"><rect x="6" y="6" width="4" height="4"/><rect x="34" y="8" width="4" height="4"/><rect x="30" y="33" width="4" height="4"/><rect x="9" y="31" width="3" height="3"/><rect x="37" y="22" width="3" height="3"/></g>
             <g ${D} opacity=".16"><rect x="12" y="11" width="3" height="3"/><rect x="28" y="4" width="3" height="3"/><rect x="5" y="22" width="3" height="3"/></g>`,
};

// ---------- Build rows once ----------
for (const game of GAMES) {
  const li = template.content.firstElementChild.cloneNode(true);
  li.dataset.id = game.id;
  li.style.setProperty('--c', game.color);

  li.querySelector('.tile-art').innerHTML = `<svg viewBox="0 0 44 44">${ART[game.id] || ''}</svg>`;
  li.querySelector('.tile-letter').textContent = game.glyph;
  li.querySelector('.name').textContent = game.name;
  if (game.tag) {
    const tag = li.querySelector('.tag');
    tag.textContent = game.tag;
    tag.dataset.tag = game.tag;
    tag.hidden = false;
  }

  li.querySelector('.open').addEventListener('click', () => {
    chrome.tabs.create({ url: game.url });
    window.close();
  });

  // Clicking the status circle toggles a manual override.
  li.querySelector('.status').addEventListener('click', async () => {
    const completed = !state.games[game.id]?.completed;
    const next = await chrome.runtime.sendMessage({ type: 'SET_STATUS', gameId: game.id, completed });
    if (next) { state = freshOrEmpty(next); render(); }
  });

  list.appendChild(li);
  rows.set(game.id, li);
}

// ---------- Render ----------
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function subtitle(entry) {
  if (!entry?.completed) return '';
  const when = timeFmt.format(entry.at);
  if (entry.source === 'manual') return `Marked done · ${when}`;
  if (entry.result === 'fail') return `Played · ${when}`;
  if (entry.result === 'win') return `Solved · ${when}`;
  return `Completed · ${when}`;
}

function render() {
  let done = 0;

  for (const game of GAMES) {
    const li = rows.get(game.id);
    const entry = state.games[game.id];
    const isDone = !!entry?.completed;
    if (isDone) done++;

    li.classList.toggle('done', isDone);
    const sub = li.querySelector('.sub');
    sub.textContent = subtitle(entry);
    sub.classList.toggle('fail', isDone && entry.result === 'fail');

    li.querySelector('.open').title = isDone ? `Open ${game.name} (completed today)` : `Play ${game.name}`;
    const status = li.querySelector('.status');
    status.title = isDone ? 'Completed — click to undo' : 'Click to mark as done';
    status.setAttribute('aria-label', `${game.name}: ${isDone ? 'completed, click to undo' : 'not completed, click to mark done'}`);
  }

  const total = GAMES.length;
  const pct = (done / total) * 100;
  $('progress-text').innerHTML = done === total
    ? `<b>${done}/${total}</b> — all done today!`
    : `<b>${done}/${total}</b> completed today`;
  const bar = document.querySelector('.bar');
  bar.style.setProperty('--p', pct.toFixed(2));
  bar.setAttribute('aria-valuenow', String(done));
  bar.setAttribute('aria-valuemax', String(total));
  document.querySelector('.card').classList.toggle('all-done', done === total);
  $('date').textContent = dateFmt.format(new Date());
}

// ---------- Midnight countdown ----------
let shownDate = todayISO();
function tick() {
  if (todayISO() !== shownDate) {
    // Day rolled over while the popup was open.
    shownDate = todayISO();
    state = emptyState();
    load();
  }
  const mins = Math.max(0, Math.ceil((nextMidnight() - Date.now()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  $('reset-countdown').textContent = `New puzzles in ${h ? `${h}h ` : ''}${m}m`;
}

// ---------- Data ----------
async function load() {
  // Ask the worker (which also performs a stale-date reset if needed).
  const s = await chrome.runtime.sendMessage({ type: 'GET_STATE' }).catch(() => null);
  if (s) { state = freshOrEmpty(s); render(); return; }
  // Fallback: read storage directly.
  const { [STATE_KEY]: raw } = await chrome.storage.local.get(STATE_KEY);
  state = freshOrEmpty(raw);
  render();
}

// Live updates from any tab / the background worker.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[STATE_KEY]) return;
  state = freshOrEmpty(changes[STATE_KEY].newValue);
  render();
});

render();
tick();
setInterval(tick, 20000);
load();
