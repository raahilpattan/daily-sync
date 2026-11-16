// Social features on top of the Firestore client. Used only by background.js.
//
// ─── Firestore schema ─────────────────────────────────────────────────────────
// users/{uid}
//     { uid, displayName, email, photoURL, friendCode, createdAt, updatedAt }
// users/{uid}/dailyStats/{YYYY-MM-DD}
//     { date, completed: { wordle: { result, at }, ... }, count, total, updatedAt }
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

/** Push today's local completion state to users/{uid}/dailyStats/{date}. */
export async function pushDailyStats(state) {
  const me = await currentUser();
  if (!me || !state) return;
  const completed = {};
  for (const g of GAMES) {
    const e = state.games?.[g.id];
    if (e?.completed) completed[g.id] = { result: e.result || 'done', at: e.at || Date.now() };
  }
  await db.set(`users/${me.uid}/dailyStats/${state.date}`, {
    date: state.date,
    completed,
    count: Object.keys(completed).length,
    total: GAMES.length,
    updatedAt: new Date(),
  });
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
  await Promise.all([
    ...stats.map((s) => db.delete(`users/${me.uid}/dailyStats/${s.id}`)),
    ...friends.map((f) => db.delete(`users/${me.uid}/friends/${f.id}`)),
  ]);
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
 * Today's leaderboard: me + every mutual friend, ranked by games completed
 * (ties go to whoever finished their last game earliest). One-way adds come back as `pending`.
 */
export async function getLeaderboard(localState) {
  const me = await requireUser();
  const date = todayISO();
  const [profile, friends] = await Promise.all([
    db.get(`users/${me.uid}`),
    db.list(`users/${me.uid}/friends`),
  ]);

  const summarize = (completedMap) => {
    const ids = GAMES.map((g) => g.id).filter((id) => completedMap?.[id]);
    const lastAt = ids.reduce((m, id) => Math.max(m, Number(completedMap[id].at) || 0), 0);
    return { completed: ids, count: ids.length, lastAt };
  };

  const localCompleted = Object.fromEntries(
    Object.entries(localState?.games || {}).filter(([, e]) => e.completed).map(([id, e]) => [id, e]),
  );
  const rows = [{ uid: me.uid, displayName: me.displayName, photoURL: me.photoURL, isMe: true, ...summarize(localCompleted) }];
  const pending = [];

  await Promise.all(friends.map(async (f) => {
    const base = { uid: f.id, displayName: f.displayName || 'Friend', photoURL: f.photoURL || null };
    try {
      const stats = await db.get(`users/${f.id}/dailyStats/${date}`);
      rows.push({ ...base, ...summarize(stats?.completed) });
    } catch (e) {
      if (e.status === 403) pending.push(base); // they haven't added me back yet
      else rows.push({ ...base, completed: [], count: 0, lastAt: 0, error: true });
    }
  }));

  rows.sort((a, b) =>
    b.count - a.count ||
    (a.count ? a.lastAt - b.lastAt : 0) ||
    a.displayName.localeCompare(b.displayName));

  pending.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return {
    date,
    total: GAMES.length,
    me: { ...me, friendCode: profile?.friendCode || null },
    rows,
    pending,
  };
}
