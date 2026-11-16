// Service worker: owns all writes to chrome.storage.local, handles the midnight reset,
// and keeps the toolbar badge in sync.

import { GAMES, GAME_IDS, STATE_KEY, todayISO, nextMidnight, emptyState, freshOrEmpty } from './shared/games.js';
import { signIn, signOut, currentUser, isFirebaseConfigured } from './shared/firebase.js';
import { ensureProfile, pushDailyStats, addFriend, removeFriend, getLeaderboard, deleteAccount } from './shared/social.js';

const ALARM = 'midnight-reset';

// --- Serialized writes ------------------------------------------------------
// Several tabs can report at once; chain read-modify-write ops so none clobber each other.
let queue = Promise.resolve();
function serialize(fn) {
  const run = queue.catch(() => {}).then(fn);
  queue = run;
  return run;
}

async function readState() {
  const { [STATE_KEY]: state } = await chrome.storage.local.get(STATE_KEY);
  return state;
}

/** Load today's state, wiping it first if it's from a previous day. */
function ensureFresh() {
  return serialize(async () => {
    const state = await readState();
    if (state && state.date === todayISO()) return state;
    const fresh = emptyState();
    await chrome.storage.local.set({ [STATE_KEY]: fresh });
    console.log('[DailyTracker] New day — state reset for', fresh.date);
    return fresh;
  });
}

function setGame(gameId, completed, meta = {}) {
  return serialize(async () => {
    const state = freshOrEmpty(await readState());
    const prev = state.games[gameId];
    if (completed) {
      // Keep the original completion time if a tab re-reports.
      if (prev?.completed && meta.source !== 'manual') return state;
      state.games[gameId] = {
        completed: true,
        result: meta.result || 'done',
        source: meta.source || 'unknown',
        at: Date.now(),
      };
    } else {
      delete state.games[gameId];
    }
    await chrome.storage.local.set({ [STATE_KEY]: state });
    syncStats(state);
    return state;
  });
}

// --- Cloud sync -------------------------------------------------------------
// Mirror today's local state to Firestore whenever it changes (if signed in).
// Fire-and-forget: local tracking never waits on, or fails because of, the network.
// A failed push is retried on the next change or the next popup open.
function syncStats(state) {
  if (!isFirebaseConfigured()) return;
  pushDailyStats(state).catch((e) => console.warn('[DailyTracker] stats sync failed:', e.message));
}

// --- Midnight reset ---------------------------------------------------------
// A one-shot alarm re-armed every night. That's more robust than periodInMinutes: 1440,
// which drifts across DST changes. If the machine was asleep, Chrome fires the overdue
// alarm on wake; and every read also date-checks, so a missed alarm can't leave stale ticks.
function scheduleMidnight() {
  chrome.alarms.create(ALARM, { when: nextMidnight().getTime() });
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM);
  // Re-arm if missing or if it points at the wrong midnight (e.g. clock/timezone change).
  if (!alarm || Math.abs(alarm.scheduledTime - nextMidnight().getTime()) > 60_000) scheduleMidnight();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  await ensureFresh(); // wipes yesterday's ticks (no-op if the alarm fired a hair early)
  scheduleMidnight();
});

chrome.runtime.onInstalled.addListener(() => { ensureFresh(); scheduleMidnight(); });
chrome.runtime.onStartup.addListener(() => { ensureFresh(); ensureAlarm(); });

// Runs every time the worker spins up.
ensureAlarm();

// --- Messages ---------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg?.type) {
    case 'GAME_COMPLETED': {
      // From content scripts. Ignore unknown games and reports dated for another day
      // (e.g. a tab that detected completion at 11:59:59 and reported after midnight).
      if (!GAME_IDS.has(msg.gameId) || msg.date !== todayISO()) {
        sendResponse({ ok: false });
        return false;
      }
      setGame(msg.gameId, true, { result: msg.result, source: msg.source })
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true; // async response
    }
    case 'SET_STATUS': {
      // From the popup's manual toggle.
      if (!GAME_IDS.has(msg.gameId)) return false;
      setGame(msg.gameId, !!msg.completed, { result: 'done', source: 'manual' })
        .then((state) => sendResponse(state));
      return true;
    }
    case 'GET_STATE': {
      ensureFresh().then((state) => sendResponse(state));
      return true;
    }

    // ---- Friends / auth (from the popup) ----
    case 'AUTH_STATE':
      respond(sendResponse, async () => ({
        configured: isFirebaseConfigured(),
        user: isFirebaseConfigured() ? await currentUser() : null,
      }));
      return true;

    case 'SIGN_IN':
      respond(sendResponse, async () => {
        const user = await signIn(); // chrome.identity.getAuthToken({ interactive: true })
        const profile = await ensureProfile();
        syncStats(await ensureFresh()); // publish today's progress straight away
        return { user, profile };
      });
      return true;

    case 'SIGN_OUT':
      respond(sendResponse, async () => { await signOut(); return {}; });
      return true;

    case 'DELETE_ACCOUNT':
      respond(sendResponse, async () => { await deleteAccount(); return {}; });
      return true;

    case 'ADD_FRIEND':
      respond(sendResponse, () => addFriend(msg.query));
      return true;

    case 'REMOVE_FRIEND':
      respond(sendResponse, () => removeFriend(msg.uid));
      return true;

    case 'GET_LEADERBOARD':
      respond(sendResponse, async () => {
        const state = await ensureFresh();
        syncStats(state); // cheap catch-up in case an earlier push failed
        return getLeaderboard(state);
      });
      return true;
  }
  return false;
});

/** Run an async handler and reply with { ok, data } or { ok: false, error, code }. */
function respond(sendResponse, fn) {
  Promise.resolve()
    .then(fn)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => {
      console.warn('[DailyTracker]', e);
      sendResponse({ ok: false, error: friendlyError(e), code: e.code || null });
    });
}

function friendlyError(e) {
  const m = String(e?.message || e);
  if (/did not approve|user.*(cancel|closed)|canceled/i.test(m)) return 'Sign-in was cancelled.';
  if (/OAuth2 not granted|bad client id|invalid_client/i.test(m)) return 'OAuth client ID is not set up. See the README.';
  if (/not configured/i.test(m)) return 'Firebase is not configured yet. See the README.';
  if (/INVALID_IDP_RESPONSE/i.test(m)) return 'Google sign-in was rejected by Firebase. Check that the Google provider is enabled.';
  if (/Failed to fetch|NetworkError/i.test(m)) return "You're offline.";
  return m;
}

// --- Badge ------------------------------------------------------------------
function updateBadge(state) {
  const s = freshOrEmpty(state);
  const left = GAMES.filter((g) => !s.games[g.id]?.completed).length;
  chrome.action.setBadgeText({ text: left === 0 ? '✓' : String(left) });
  chrome.action.setBadgeBackgroundColor({ color: left === 0 ? '#16a34a' : '#3f3f46' });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STATE_KEY]) updateBadge(changes[STATE_KEY].newValue);
});

readState().then(updateBadge);
