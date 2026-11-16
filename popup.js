import { GAMES, STATE_KEY, todayISO, nextMidnight, freshOrEmpty, emptyState } from './shared/games.js';

const $ = (id) => document.getElementById(id);
const list = $('game-list');
const template = $('row-template');

let state = emptyState();
const rows = new Map(); // gameId -> <li>

// ---------- Build rows once ----------
for (const game of GAMES) {
  const li = template.content.firstElementChild.cloneNode(true);
  li.dataset.id = game.id;
  li.querySelector('.glyph').textContent = game.glyph;
  li.querySelector('.glyph').style.setProperty('--tile', game.color);
  li.querySelector('.name').textContent = game.name;

  li.querySelector('.open').addEventListener('click', () => {
    chrome.tabs.create({ url: game.url });
    window.close();
  });

  li.querySelector('.toggle').addEventListener('click', async (e) => {
    e.stopPropagation();
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

function subtitle(game, entry) {
  if (!entry?.completed) return game.source;
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
    sub.textContent = subtitle(game, entry);
    sub.classList.toggle('fail', isDone && entry.result === 'fail');

    const open = li.querySelector('.open');
    open.title = isDone ? `Open ${game.name} (completed today)` : `Play ${game.name}`;

    const toggle = li.querySelector('.toggle');
    toggle.textContent = isDone ? 'Undo' : 'Mark done';
    toggle.title = isDone ? 'Mark as not completed' : 'Mark as completed manually';
  }

  const total = GAMES.length;
  const pct = Math.round((done / total) * 100);
  $('progress-text').innerHTML = `<b>${done}/${total}</b> completed today`;
  $('progress-pct').textContent = done === total ? 'All done 🎉' : `${pct}%`;
  $('bar-fill').style.width = `${pct}%`;
  document.querySelector('.bar').setAttribute('aria-valuenow', String(done));
  document.querySelector('.bar').setAttribute('aria-valuemax', String(total));
  document.querySelector('.widget').classList.toggle('all-done', done === total);
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
