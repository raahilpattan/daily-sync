// Social features on top of the Firestore client. Used only by background.js.
//
// ─── Firestore schema ─────────────────────────────────────────────────────────
// users/{uid}
//     { uid, displayName, email, photoURL, friendCode, createdAt, updatedAt }
// users/{uid}/dailyStats/{YYYY-MM-DD}
//     { date, completed: { wordle: { at }, ... }, tracked: [ids], count, total, streak, updatedAt }
//     `tracked` = the games this user keeps in their list; count/total are out of those.
// users/{uid}/dailyStats/{YYYY-MM-DD}/results/{gameId}
//     { game, result, summary, grid, at }   ← readable by a friend only if THEY finished
//                                              that game today too (see firestore.rules)
// users/{uid}/friends/{friendUid}
//     { uid, displayName, photoURL, addedAt }      ← people *I* added
// friendCodes/{CODE}        { uid, displayName, photoURL }   ← lookup by friend code
// emailIndex/{emailLower}   { uid, displayName, photoURL }   ← lookup by exact email
//
// Friendship is mutual by design: I can read your dailyStats only if YOU have added ME
// (see firestore.rules). If I add you and you haven't added me back, you show as "pending".
// That way nobody can watch your stats just by knowing your email.

import { db, currentUser, deleteAuthUser } from './firebase.js';
import { GAMES, todayISO } from './games.js';
import { addDays } from './history.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const CODE_LEN = 6;

function makeCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

const normCode = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function requireUser() {
  const me = await currentUser();
  if (!me) throw Object.assign(new Error('Not signed in'), { code: 'signed-out' });
  return me;
}

/** Create/refresh my profile and lookup docs. Returns the profile (with friendCode). */
export async function ensureProfile() {
  const me = await requireUser();
  const existing = await db.get(`users/${me.uid}`);
  const card = { uid: me.uid, displayName: me.displayName, photoURL: me.photoURL };

  let friendCode = existing?.friendCode;
  if (!friendCode) {
    // Claim a unique code (create-only write; retry on the rare collision).
    for (let i = 0; i < 5 && !friendCode; i++) {
      const code = makeCode();
      try {
        await db.set(`friendCodes/${code}`, card, { mustNotExist: true });
        friendCode = code;
      } catch (e) {
        // Taken: precondition failure (400/409), or 403 when the rules see an update to someone else's code.
        if (![400, 403, 409].includes(e.status)) throw e;
      }
    }
    if (!friendCode) throw new Error('Could not allocate a friend code, try again');
  } else {
    await db.set(`friendCodes/${friendCode}`, card); // keep name/photo fresh
  }

  if (me.email) await db.set(`emailIndex/${me.email.toLowerCase()}`, card);

  const profile = {
    uid: me.uid,
    displayName: me.displayName,
    email: me.email,
    photoURL: me.photoURL,
    friendCode,
    createdAt: existing?.createdAt ? new Date(existing.createdAt) : new Date(),
    updatedAt: new Date(),
  };
  await db.set(`users/${me.uid}`, profile);
  return { ...profile, createdAt: undefined, updatedAt: undefined };
}

// What we last wrote to each results doc, so unchanged results aren't rewritten on every
// push. Keyed by "uid/date/gameId"; null means "known not to exist". Resets with the worker.
const pushedResults = new Map();

/**
 * Push today's local state to Firestore. `snap` comes from background.js:
 *   { state, tracked: [ids the user keeps in their list], streak }
 *
 *   dailyStats/{date}                → which games are done, and when (no scores)
 *   dailyStats/{date}/results/{game} → the score and emoji grid, locked behind the rules
 */
export async function pushDailyStats(snap) {
  const me = await currentUser();
  const state = snap?.state;
  if (!me || !state) return;
  const tracked = snap.tracked?.length ? snap.tracked : GAMES.map((g) => g.id);
  // Every finished game goes in `completed` (it unlocks friends' results for that game),
  // but count/total only cover the games in the user's list.
  const completed = {};
  for (const g of GAMES) {
    const e = state.games?.[g.id];
    if (e?.completed) completed[g.id] = { at: e.at || Date.now() };
  }
  const statsPath = `users/${me.uid}/dailyStats/${state.date}`;
  await db.set(statsPath, {
    date: state.date,
    completed,
    tracked,
    count: tracked.filter((id) => completed[id]).length,
    total: tracked.length,
    streak: Math.max(0, Math.floor(snap.streak || 0)),
    updatedAt: new Date(),
  });

  await Promise.all(GAMES.map(async (g) => {
    const key = `${me.uid}/${state.date}/${g.id}`;
    const path = `${statsPath}/results/${g.id}`;
    const e = state.games?.[g.id];
    if (e?.completed) {
      const doc = {
        game: g.id,
        result: e.result || 'done',
        summary: e.detail?.summary || '',
        grid: e.detail?.grid || '',
        at: e.at || Date.now(),
      };
      const json = JSON.stringify(doc);
      if (pushedResults.get(key) === json) return;
      await db.set(path, doc);
      pushedResults.set(key, json);
    } else if (pushedResults.get(key) !== null) {
      await db.delete(path); // unticked (or unknown after a worker restart)
      pushedResults.set(key, null);
    }
  }));
}

/**
 * A friend's results for today, one entry per game they've finished.
 * A game's score and grid are only returned if I've finished that game today too.
 * The UI hides them anyway, but firestore.rules is what actually enforces it.
 */
export async function getFriendResults(uid, snap) {
  await requireUser();
  const date = todayISO();
  const localState = snap?.state;
  // The rules check MY dailyStats on the server, so make sure it's current first.
  await pushDailyStats(snap);

  const stats = await db.get(`users/${uid}/dailyStats/${date}`);
  const theirs = stats?.completed || {};
  const games = await Promise.all(GAMES.filter((g) => theirs[g.id]).map(async (g) => {
    const base = { id: g.id, at: Number(theirs[g.id].at) || null };
    if (!localState?.games?.[g.id]?.completed) return { ...base, locked: true };
    try {
      const r = await db.get(`users/${uid}/dailyStats/${date}/results/${g.id}`);
      if (!r) return { ...base, locked: false, result: 'done', summary: '', grid: '' };
      return { ...base, locked: false, result: r.result || 'done', summary: r.summary || '', grid: r.grid || '' };
    } catch (e) {
      if (e.status === 403) return { ...base, locked: true };
      throw e;
    }
  }));
  return { date, games };
}

/** Add a friend by email address or friend code. */
export async function addFriend(input) {
  const me = await requireUser();
  const raw = String(input || '').trim();
  if (!raw) throw new Error('Enter an email or friend code');

  const isEmail = raw.includes('@');
  const key = isEmail ? raw.toLowerCase() : normCode(raw);
  if (!isEmail && key.length !== CODE_LEN) throw new Error(`Friend codes are ${CODE_LEN} characters`);

  const hit = await db.get(isEmail ? `emailIndex/${key}` : `friendCodes/${key}`);
  if (!hit?.uid) {
    throw new Error(isEmail ? 'No player with that email. They need to sign in once first.' : 'No player with that code');
  }
  if (hit.uid === me.uid) throw new Error("That's you!");

  await db.set(`users/${me.uid}/friends/${hit.uid}`, {
    uid: hit.uid,
    displayName: hit.displayName || 'Friend',
    photoURL: hit.photoURL || null,
    addedAt: new Date(),
  });
  return { uid: hit.uid, displayName: hit.displayName };
}

/**
 * Delete everything this user owns in Firestore, then their Firebase Auth account.
 * Friends who added this user keep their own `friends/{uid}` entry (we can't write to
 * their data), but it can no longer read anything because the stats are gone.
 */
export async function deleteAccount() {
  const me = await requireUser();
  const profile = await db.get(`users/${me.uid}`);
  const [stats, friends] = await Promise.all([
    db.list(`users/${me.uid}/dailyStats`),
    db.list(`users/${me.uid}/friends`),
  ]);
  // Subcollections outlive their parent doc in Firestore, so delete each day's results first.
  await Promise.all(stats.map(async (s) => {
    const results = await db.list(`users/${me.uid}/dailyStats/${s.id}/results`);
    await Promise.all(results.map((r) => db.delete(`users/${me.uid}/dailyStats/${s.id}/results/${r.id}`)));
  }));
  await Promise.all([
    ...stats.map((s) => db.delete(`users/${me.uid}/dailyStats/${s.id}`)),
    ...friends.map((f) => db.delete(`users/${me.uid}/friends/${f.id}`)),
  ]);
  pushedResults.clear();
  if (profile?.friendCode) await db.delete(`friendCodes/${profile.friendCode}`).catch(() => {});
  if (me.email) await db.delete(`emailIndex/${me.email.toLowerCase()}`).catch(() => {});
  await db.delete(`users/${me.uid}`);
  await deleteAuthUser();
}

export async function removeFriend(uid) {
  const me = await requireUser();
  await db.delete(`users/${me.uid}/friends/${uid}`);
}

/**
 * Today's leaderboard: me + every mutual friend. Everyone is scored out of the games in
 * their own list, so ranking is by games finished, then by share of their list finished,
 * then by whoever finished their last game earliest. One-way adds come back as `pending`.
 */
export async function getLeaderboard(snap) {
  const me = await requireUser();
  const date = todayISO();
  const [profile, friends] = await Promise.all([
    db.get(`users/${me.uid}`),
    db.list(`users/${me.uid}/friends`),
  ]);

  const ALL = GAMES.map((g) => g.id);
  const summarize = (completedMap, trackedIds) => {
    const tracked = (Array.isArray(trackedIds) && trackedIds.length ? trackedIds : ALL).filter((id) => ALL.includes(id));
    const ids = tracked.filter((id) => completedMap?.[id]);
    const lastAt = ids.reduce((m, id) => Math.max(m, Number(completedMap[id].at) || 0), 0);
    return { tracked, completed: ids, count: ids.length, total: tracked.length, lastAt };
  };

  const localCompleted = Object.fromEntries(
    Object.entries(snap?.state?.games || {}).filter(([, e]) => e.completed).map(([id, e]) => [id, e]),
  );
  const rows = [{
    uid: me.uid, displayName: me.displayName, photoURL: me.photoURL, isMe: true,
    streak: snap?.streak || 0,
    ...summarize(localCompleted, snap?.tracked),
  }];
  const pending = [];

  await Promise.all(friends.map(async (f) => {
    const base = { uid: f.id, displayName: f.displayName || 'Friend', photoURL: f.photoURL || null };
    try {
      const stats = await db.get(`users/${f.id}/dailyStats/${date}`);
      let streak = Number.isInteger(stats?.streak) ? stats.streak : null;
      let tracked = stats?.tracked;
      if (!stats) {
        // Not played yet today: their streak is still alive if they played yesterday.
        const prev = await db.get(`users/${f.id}/dailyStats/${addDays(date, -1)}`).catch(() => null);
        streak = Number.isInteger(prev?.streak) ? prev.streak : null;
        tracked = prev?.tracked;
      }
      rows.push({ ...base, streak, ...summarize(stats?.completed, tracked) });
    } catch (e) {
      if (e.status === 403) pending.push(base); // they haven't added me back yet
      else rows.push({ ...base, tracked: ALL, completed: [], count: 0, total: ALL.length, lastAt: 0, streak: null, error: true });
    }
  }));

  const ratio = (r) => (r.total ? r.count / r.total : 0);
  rows.sort((a, b) =>
    b.count - a.count ||
    ratio(b) - ratio(a) ||
    (a.count ? a.lastAt - b.lastAt : 0) ||
    a.displayName.localeCompare(b.displayName));

  pending.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    date,
    me: { ...me, friendCode: profile?.friendCode || null },
    rows,
    pending,
  };
}
