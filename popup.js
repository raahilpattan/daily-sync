import {
  GAMES, STATE_KEY, PREFS_KEY, todayISO, nextMidnight, freshOrEmpty, emptyState,
  normalizePrefs, orderedGames, visibleGames,
} from './shared/games.js';
import { HISTORY_KEY, streaks, perfectDays, averageLabel, calendar } from './shared/history.js';
import { activateFriends, onLocalProgressChanged } from './friends.js';

const $ = (id) => document.getElementById(id);
const list = $('game-list');
const template = $('row-template');

let state = emptyState();
let prefs = normalizePrefs(null); // { order, hidden }, from chrome.storage.sync
let history = {};                 // from chrome.storage.local, written by the worker
let editing = false;
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

  // Edit mode: show/hide this game.
  li.querySelector('.vis').addEventListener('click', () => {
    const hidden = new Set(prefs.hidden);
    if (hidden.has(game.id)) hidden.delete(game.id);
    else if (visibleGames(prefs).length > 1) hidden.add(game.id); // keep at least one
    savePrefs({ ...prefs, hidden: [...hidden] });
  });

  // Edit mode: drag the handle to reorder, or use the arrow keys on it.
  const handle = li.querySelector('.handle');
  handle.addEventListener('pointerdown', (e) => startDrag(e, li));
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const order = [...prefs.order];
    const i = order.indexOf(game.id);
    const j = i + (e.key === 'ArrowUp' ? -1 : 1);
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    savePrefs({ ...prefs, order });
    handle.focus();
  });

  list.appendChild(li);
  rows.set(game.id, li);
}

// ---------- Edit mode (hide / reorder) ----------
function savePrefs(next) {
  prefs = normalizePrefs(next);
  render();
  chrome.runtime.sendMessage({ type: 'SET_PREFS', prefs }).catch(() => {});
}

function setEditing(on) {
  editing = on;
  list.classList.toggle('editing', on);
  $('edit-hint').hidden = !on;
  const btn = $('edit-btn');
  btn.textContent = on ? 'Done' : 'Edit';
  btn.setAttribute('aria-pressed', String(on));
  for (const li of rows.values()) li.querySelector('.handle').tabIndex = on ? 0 : -1;
  render();
}
$('edit-btn').addEventListener('click', () => setEditing(!editing));

/** Pointer-based drag: the row follows the pointer, and the others shuffle around it. */
function startDrag(e, li) {
  if (!editing || e.button !== 0) return;
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  li.classList.add('dragging');
  let lastY = e.clientY;

  const move = (ev) => {
    const y = ev.clientY;
    const down = y > lastY;
    lastY = y;
    // Swap with the neighbour once the pointer passes its midpoint.
    const sib = down ? li.nextElementSibling : li.previousElementSibling;
    if (!sib) return;
    const r = sib.getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (down && y > mid) sib.after(li);
    else if (!down && y < mid) sib.before(li);
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    li.classList.remove('dragging');
    savePrefs({ ...prefs, order: [...list.children].map((el) => el.dataset.id) });
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

// ---------- Render ----------
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function subtitle(entry) {
  if (!entry?.completed) return '';
  const when = timeFmt.format(entry.at);
  // A score says enough on its own ("4/6 · 9:14 AM"); otherwise say how it ended.
  if (entry.detail?.summary) return `${entry.detail.summary} · ${when}`;
  if (entry.source === 'manual') return `Marked done · ${when}`;
  if (entry.result === 'fail') return `Played · ${when}`;
  if (entry.result === 'win') return `Solved · ${when}`;
  return `Completed · ${when}`;
}

function render() {
  let done = 0;
  const visible = visibleGames(prefs);
  const hidden = new Set(prefs.hidden);

  // Put rows in the user's order (appendChild moves existing nodes).
  for (const game of orderedGames(prefs)) list.appendChild(rows.get(game.id));

  for (const game of GAMES) {
    const li = rows.get(game.id);
    const entry = state.games[game.id];
    const isDone = !!entry?.completed;
    const isHidden = hidden.has(game.id);
    if (isDone && !isHidden) done++;

    li.hidden = isHidden && !editing;
    li.classList.toggle('off', isHidden);
    const vis = li.querySelector('.vis');
    vis.setAttribute('aria-pressed', String(!isHidden));
    vis.title = isHidden ? `Show ${game.name}` : `Hide ${game.name}`;
    vis.setAttribute('aria-label', vis.title);
    vis.disabled = !isHidden && visible.length === 1;

    li.classList.toggle('done', isDone);
    const sub = li.querySelector('.sub');
    sub.textContent = subtitle(entry);
    sub.classList.toggle('fail', isDone && entry.result === 'fail');

    li.querySelector('.open').title = isDone ? `Open ${game.name} (completed today)` : `Play ${game.name}`;
    const status = li.querySelector('.status');
    status.title = isDone ? 'Completed — click to undo' : 'Click to mark as done';
    status.setAttribute('aria-label', `${game.name}: ${isDone ? 'completed, click to undo' : 'not completed, click to mark done'}`);
  }

  const total = visible.length;
  const pct = total ? (done / total) * 100 : 0;
  $('progress-text').innerHTML = done === total
    ? `<b>${done}/${total}</b> — all done today!`
    : `<b>${done}/${total}</b> completed today`;
  const bar = document.querySelector('.bar');
  bar.style.setProperty('--p', pct.toFixed(2));
  bar.setAttribute('aria-valuenow', String(done));
  bar.setAttribute('aria-valuemax', String(total));
  document.querySelector('.card').classList.toggle('all-done', done === total);
  $('date').textContent = dateFmt.format(new Date());

  // Streak chip next to the progress text.
  const st = streaks(history);
  const chip = $('streak-chip');
  chip.hidden = st.current < 1;
  chip.textContent = `🔥 ${st.current}`;
  chip.title = st.playedToday
    ? `${st.current}-day streak`
    : `${st.current}-day streak. Finish a puzzle today to keep it going!`;
  chip.classList.toggle('pending', !st.playedToday);

  if (activeTab === 'stats') renderStats();
}

// ---------- Stats tab ----------
const calFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const WEEKS = 16;

function renderStats() {
  const st = streaks(history);
  $('st-current').textContent = String(st.current);
  $('st-best').textContent = String(st.best);
  $('st-perfect').textContent = String(perfectDays(history));
  $('stats-empty').hidden = st.days > 0;

  // Calendar heatmap: columns are weeks, rows are Mon..Sun.
  const cells = calendar(history, WEEKS);
  const cal = $('calendar');
  cal.replaceChildren(...cells.map((c) => {
    const el = document.createElement('span');
    const ratio = c.total ? c.done / c.total : 0;
    const level = c.future ? -1 : c.done === 0 ? 0 : ratio >= 1 ? 4 : ratio >= 0.6 ? 3 : ratio >= 0.3 ? 2 : 1;
    el.className = `cell l${level}${c.date === todayISO() ? ' today' : ''}`;
    if (!c.future) {
      const [y, m, d] = c.date.split('-').map(Number);
      el.title = `${calFmt.format(new Date(y, m - 1, d))}: ${c.done ? `${c.done}/${c.total}` : 'nothing played'}`;
    }
    return el;
  }));
  cal.setAttribute('aria-label', `Last ${WEEKS} weeks: played on ${cells.filter((c) => c.done).length} days`);

  // Per-game rows: visible games, plus hidden ones that have history.
  const items = [];
  for (const game of orderedGames(prefs)) {
    const gs = streaks(history, game.id);
    if (prefs.hidden.includes(game.id) && !gs.days) continue;
    const li = document.createElement('li');
    li.style.setProperty('--c', game.color);
    const tile = Object.assign(document.createElement('span'), { className: 'gs-tile', textContent: game.glyph });
    const text = document.createElement('span');
    text.className = 'gs-text';
    text.append(
      Object.assign(document.createElement('span'), { className: 'gs-name', textContent: game.name }),
      Object.assign(document.createElement('span'), {
        className: 'gs-sub',
        textContent: gs.days
          ? [`${gs.days} day${gs.days === 1 ? '' : 's'}`, gs.best > 1 ? `best ${gs.best}` : '', averageLabel(history, game.id)].filter(Boolean).join(' · ')
          : 'Not played yet',
      }),
    );
    const streak = Object.assign(document.createElement('span'), {
      className: `gs-streak${gs.current ? '' : ' zero'}`,
      textContent: gs.current ? `🔥 ${gs.current}` : '–',
      title: gs.current ? `${gs.current}-day streak` : 'No current streak',
    });
    li.append(tile, text, streak);
    items.push(li);
  }
  $('game-stats').replaceChildren(...items);
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
  const [{ [PREFS_KEY]: p }, { [HISTORY_KEY]: h }] = await Promise.all([
    chrome.storage.sync.get(PREFS_KEY).catch(() => ({})),
    chrome.storage.local.get(HISTORY_KEY),
  ]);
  prefs = normalizePrefs(p);
  history = h || {};
  // Ask the worker (which also performs a stale-date reset if needed).
  const s = await chrome.runtime.sendMessage({ type: 'GET_STATE' }).catch(() => null);
  if (s) { state = freshOrEmpty(s); render(); return; }
  // Fallback: read storage directly.
  const { [STATE_KEY]: raw } = await chrome.storage.local.get(STATE_KEY);
  state = freshOrEmpty(raw);
  render();
}

// Live updates from any tab / the background worker / another computer (sync).
chrome.storage.onChanged.addListener((changes, area) => {
  let dirty = false;
  if (area === 'local' && changes[HISTORY_KEY]) { history = changes[HISTORY_KEY].newValue || {}; dirty = true; }
  if (area === 'sync' && changes[PREFS_KEY]) { prefs = normalizePrefs(changes[PREFS_KEY].newValue); dirty = true; }
  if (area === 'local' && changes[STATE_KEY]) {
    state = freshOrEmpty(changes[STATE_KEY].newValue);
    dirty = true;
    onLocalProgressChanged();
  }
  if (dirty && !document.querySelector('.game.dragging')) render();
});

// ---------- Tabs ----------
const TABS = ['games', 'stats', 'friends'];
let activeTab = 'games';

function selectTab(name, { animate = true } = {}) {
  if (!TABS.includes(name)) name = 'games';
  const prev = activeTab;
  activeTab = name;
  document.querySelector('.tabs').dataset.active = name;

  for (const t of TABS) {
    const tab = $(`tab-${t}`);
    const panel = $(`panel-${t}`);
    const on = t === name;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    panel.hidden = !on;
    panel.classList.remove('enter-left', 'enter-right');
    if (on && animate && prev !== name) {
      void panel.offsetWidth; // restart the CSS animation
      panel.classList.add(TABS.indexOf(name) > TABS.indexOf(prev) ? 'enter-right' : 'enter-left');
    }
  }
  try { localStorage.setItem('popup-tab', name); } catch { /* storage unavailable */ }
  if (name !== 'games' && editing) setEditing(false);
  if (name === 'friends') activateFriends();
  if (name === 'stats') renderStats();
}

for (const t of TABS) $(`tab-${t}`).addEventListener('click', () => selectTab(t));
document.querySelector('.tabs').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const i = TABS.indexOf(activeTab) + (e.key === 'ArrowRight' ? 1 : -1);
  const next = TABS[(i + TABS.length) % TABS.length];
  selectTab(next);
  $(`tab-${next}`).focus();
});

let savedTab = 'games';
try { savedTab = localStorage.getItem('popup-tab') || 'games'; } catch { /* storage unavailable */ }
selectTab(savedTab, { animate: false });

render();
tick();
setInterval(tick, 20000);
load();
