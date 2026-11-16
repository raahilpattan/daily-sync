// Friends tab: sign-in, leaderboard, add/remove friends.
// All network work happens in the service worker. This file only sends messages and renders.
// Names and photos come from other users, so they're only ever set via textContent / img.src.

import { GAMES } from './shared/games.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg).catch((e) => ({ ok: false, error: String(e.message || e) }));

const views = {
  unconfigured: $('friends-unconfigured'),
  signedOut: $('friends-signed-out'),
  signedIn: $('friends-signed-in'),
};

let loaded = false;
let loading = false;

function show(view) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== view;
}

function setMsg(el, text, kind = '') {
  el.textContent = text || '';
  el.className = `form-msg ${kind}`;
  el.hidden = !text;
}

// ---------- Avatars ----------
const AVATAR_COLORS = ['#6b7fd7', '#c2697a', '#4f9d8a', '#b8873b', '#8a6bc2', '#5f8fb0', '#a8664a'];
function avatar({ uid = '', displayName = '?', photoURL = null }, cls = 'avatar') {
  const el = document.createElement('span');
  el.className = cls;
  let h = 0;
  for (const ch of uid) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  el.style.setProperty('--av', AVATAR_COLORS[h % AVATAR_COLORS.length]);
  el.textContent = (displayName.trim()[0] || '?').toUpperCase();
  if (photoURL && /^https:\/\//.test(photoURL)) {
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { el.textContent = ''; el.appendChild(img); };
    img.src = photoURL;
  }
  return el;
}

// ---------- Leaderboard ----------
function skeleton() {
  const board = $('leaderboard');
  board.replaceChildren(...[0, 1, 2].map(() => Object.assign(document.createElement('li'), { className: 'skeleton' })));
}

function renderBoard(data) {
  const board = $('leaderboard');
  const nodes = [];
  let rank = 0, prevKey = null;

  data.rows.forEach((r, i) => {
    // Shared rank for exact ties on count (and finish time).
    const key = `${r.count}:${r.count ? r.lastAt : 0}`;
    if (key !== prevKey) rank = i + 1;
    prevKey = key;

    const li = document.createElement('li');
    if (r.isMe) li.classList.add('me');

    const rk = document.createElement('span');
    rk.className = `rank${r.count && rank <= 3 ? ` r${rank}` : ''}`;
    rk.textContent = String(rank);

    const who = document.createElement('div');
    who.className = 'who';
    const nameRow = document.createElement('span');
    nameRow.className = 'who-name';
    const nm = document.createElement('span');
    nm.className = 'nm';
    nm.textContent = r.displayName;
    nameRow.append(nm);
    if (r.isMe) nameRow.append(Object.assign(document.createElement('span'), { className: 'you-pill', textContent: 'YOU' }));

    const dots = document.createElement('span');
    dots.className = 'dots';
    for (const g of GAMES) {
      const d = document.createElement('span');
      const on = r.completed.includes(g.id);
      d.className = `dot${on ? ' on' : ''}`;
      d.style.setProperty('--c', g.color);
      d.title = `${g.name}${on ? ' ✓' : ''}`;
      dots.append(d);
    }
    who.append(nameRow, dots);

    const score = document.createElement('span');
    score.className = `score${r.count ? '' : ' zero'}`;
    score.append(String(r.count), Object.assign(document.createElement('small'), { textContent: `/${data.total}` }));
    if (r.error) score.title = "Couldn't load";

    li.append(rk, avatar(r), who, score);
    if (!r.isMe) li.append(removeButton(r));
    nodes.push(li);
  });

  if (data.rows.length === 1) {
    const note = document.createElement('li');
    note.className = 'board-note';
    note.textContent = 'Add a friend below to start a leaderboard.';
    nodes.push(note);
  }
  board.replaceChildren(...nodes);

  const pend = $('pending');
  pend.replaceChildren(...data.pending.map((p) => {
    const li = document.createElement('li');
    li.append(avatar(p), Object.assign(document.createElement('span'), { textContent: p.displayName }), removeButton(p));
    return li;
  }));
  $('pending-wrap').hidden = data.pending.length === 0;
}

function removeButton(friend) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'remove';
  b.textContent = '×';
  b.title = `Remove ${friend.displayName}`;
  b.setAttribute('aria-label', `Remove ${friend.displayName}`);
  b.addEventListener('click', async () => {
    b.disabled = true;
    const res = await send({ type: 'REMOVE_FRIEND', uid: friend.uid });
    if (!res?.ok) { setMsg($('add-msg'), res?.error || 'Could not remove', 'error'); b.disabled = false; return; }
    refresh();
  });
  return b;
}

function renderMe(me) {
  $('me-avatar').replaceWith(Object.assign(avatar(me), { id: 'me-avatar' }));
  $('me-name').textContent = me.displayName;
  $('me-code').textContent = me.friendCode || '······';
}

async function refresh() {
  if (loading) return;
  loading = true;
  $('refresh-btn').classList.add('spinning');
  if (!loaded) skeleton();
  const res = await send({ type: 'GET_LEADERBOARD' });
  loading = false;
  $('refresh-btn').classList.remove('spinning');

  if (!res?.ok) {
    if (res?.code === 'signed-out') return init(true);
    $('leaderboard').replaceChildren(Object.assign(document.createElement('li'), { className: 'board-note', textContent: res?.error || 'Could not load leaderboard' }));
    return;
  }
  loaded = true;
  renderMe(res.data.me);
  renderBoard(res.data);
}

// ---------- Auth ----------
async function init(force = false) {
  if (loaded && !force) return refresh();
  loaded = false;
  const res = await send({ type: 'AUTH_STATE' });
  const st = res?.data;
  if (!st?.configured) return show('unconfigured');
  if (!st.user) return show('signedOut');
  show('signedIn');
  renderMe({ ...st.user, friendCode: null });
  refresh();
}

$('signin-btn').addEventListener('click', async () => {
  const btn = $('signin-btn');
  btn.disabled = true;
  setMsg($('signin-msg'), 'Signing in…');
  const res = await send({ type: 'SIGN_IN' });
  btn.disabled = false;
  if (!res?.ok) return setMsg($('signin-msg'), res?.error || 'Sign-in failed', 'error');
  setMsg($('signin-msg'), '');
  init(true);
});

$('signout-btn').addEventListener('click', async () => {
  await send({ type: 'SIGN_OUT' });
  loaded = false;
  show('signedOut');
});

// Two-step delete: first click arms it, second click (within 5s) deletes.
let deleteTimer = null;
$('delete-btn').addEventListener('click', async () => {
  const btn = $('delete-btn');
  if (!btn.classList.contains('armed')) {
    btn.classList.add('armed');
    btn.textContent = 'Click again to permanently delete';
    deleteTimer = setTimeout(() => { btn.classList.remove('armed'); btn.textContent = 'Delete account'; }, 5000);
    return;
  }
  clearTimeout(deleteTimer);
  btn.disabled = true;
  btn.textContent = 'Deleting…';
  const res = await send({ type: 'DELETE_ACCOUNT' });
  btn.disabled = false;
  btn.classList.remove('armed');
  btn.textContent = 'Delete account';
  if (!res?.ok) return setMsg($('add-msg'), res?.error || 'Could not delete account', 'error');
  loaded = false;
  show('signedOut');
  setMsg($('signin-msg'), 'Your account and all its data were deleted.', 'ok');
});

$('copy-code').addEventListener('click', async () => {
  const code = $('me-code').textContent;
  if (!/^[A-Z0-9]{6}$/.test(code)) return;
  try {
    await navigator.clipboard.writeText(code);
    const chip = $('copy-code');
    chip.classList.add('copied');
    setTimeout(() => chip.classList.remove('copied'), 1200);
  } catch { /* clipboard blocked */ }
});

$('refresh-btn').addEventListener('click', () => refresh());

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('add-input');
  const query = input.value.trim();
  if (!query) return;
  $('add-btn').disabled = true;
  setMsg($('add-msg'), 'Looking up…');
  const res = await send({ type: 'ADD_FRIEND', query });
  $('add-btn').disabled = false;
  if (!res?.ok) return setMsg($('add-msg'), res?.error || 'Could not add friend', 'error');
  input.value = '';
  setMsg($('add-msg'), `Added ${res.data.displayName}. They'll appear once they add you back.`, 'ok');
  refresh();
});

/** Called by popup.js whenever the Friends tab is shown. */
export function activateFriends() {
  init();
}

/** Called when local progress changes, so "You" stays current. */
export function onLocalProgressChanged() {
  if (loaded && !views.signedIn.hidden) refresh();
}
