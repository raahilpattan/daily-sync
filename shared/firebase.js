// Minimal Firebase Auth + Firestore client over REST (fetch only, so it runs in the MV3
// service worker). Used only by background.js. The popup talks to the worker by message.
//
// Auth flow:
//   chrome.identity.getAuthToken()  → Google OAuth access token
//   identitytoolkit accounts:signInWithIdp → Firebase ID token + refresh token
//   Firestore requests carry "Authorization: Bearer <Firebase ID token>",
//   so security rules see request.auth.uid.

import { initFirebase, isFirebaseConfigured } from '../firebase-config.js';

const SESSION_KEY = 'fbSession';
let cfg = null;
const config = () => (cfg ??= initFirebase());

export { isFirebaseConfigured };

// =============================================================================
// Auth
// =============================================================================

async function googleAccessToken(interactive) {
  const res = await chrome.identity.getAuthToken({ interactive });
  return typeof res === 'string' ? res : res?.token;
}

async function exchangeGoogleToken(accessToken) {
  const { authBase, apiKey } = config();
  const r = await fetch(`${authBase}/accounts:signInWithIdp?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `access_token=${encodeURIComponent(accessToken)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnSecureToken: true,
      returnIdpCredential: true,
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error?.message || `Sign-in failed (${r.status})`), { status: r.status });
  return {
    uid: j.localId,
    email: j.email || '',
    displayName: j.displayName || j.fullName || (j.email || '').split('@')[0] || 'Player',
    photoURL: j.photoUrl || null,
    idToken: j.idToken,
    refreshToken: j.refreshToken,
    expiresAt: Date.now() + Number(j.expiresIn || 3600) * 1000,
  };
}

async function saveSession(s) { await chrome.storage.local.set({ [SESSION_KEY]: s }); return s; }
async function loadSession() { return (await chrome.storage.local.get(SESSION_KEY))[SESSION_KEY] || null; }

const publicUser = (s) => s && { uid: s.uid, email: s.email, displayName: s.displayName, photoURL: s.photoURL };

async function signInWith(interactive) {
  let token = await googleAccessToken(interactive);
  if (!token) throw new Error('No Google token');
  try {
    return await saveSession(await exchangeGoogleToken(token));
  } catch (e) {
    // Chrome may hand back a cached, already-revoked token. Drop it and try once more.
    await chrome.identity.removeCachedAuthToken({ token });
    token = await googleAccessToken(interactive);
    return saveSession(await exchangeGoogleToken(token));
  }
}

/** Interactive Google sign-in (opens Chrome's account picker if needed). */
export async function signIn() {
  return publicUser(await signInWith(true));
}

export async function signOut() {
  await chrome.storage.local.remove(SESSION_KEY);
  try { await chrome.identity.clearAllCachedAuthTokens(); } catch { /* older Chrome */ }
}

/** Permanently delete the Firebase Auth account, then sign out locally. */
export async function deleteAuthUser() {
  const { authBase, apiKey } = config();
  const idToken = await getIdToken();
  const r = await fetch(`${authBase}/accounts:delete?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.error?.message || `Account deletion failed (${r.status})`);
  }
  await signOut();
}

export async function currentUser() {
  return publicUser(await loadSession());
}

let refreshing = null;
/** A valid Firebase ID token, refreshed when it's within 2 minutes of expiry. */
async function getIdToken() {
  const s = await loadSession();
  if (!s) throw Object.assign(new Error('Not signed in'), { code: 'signed-out' });
  if (s.expiresAt - 120_000 > Date.now()) return s.idToken;

  refreshing ??= (async () => {
    const { tokenUrl, apiKey } = config();
    try {
      const r = await fetch(`${tokenUrl}?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(s.refreshToken)}`,
      });
      if (!r.ok) throw new Error('refresh failed');
      const j = await r.json();
      const next = { ...s, idToken: j.id_token, refreshToken: j.refresh_token, expiresAt: Date.now() + Number(j.expires_in) * 1000 };
      await saveSession(next);
      return next.idToken;
    } catch {
      // Refresh token revoked/expired: try a silent Google re-auth before giving up.
      try {
        return (await signInWith(false)).idToken;
      } catch {
        await signOut();
        throw Object.assign(new Error('Session expired, please sign in again'), { code: 'signed-out' });
      }
    }
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// =============================================================================
// Firestore (REST v1)
// =============================================================================

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: encFields(v) } };
}
const encFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)]));

function dec(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return decFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  return null;
}
const decFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, dec(v)]));
const docId = (name) => decodeURIComponent(name.split('/').pop());

async function request(method, path, { body, params = [] } = {}) {
  const token = await getIdToken();
  const url = new URL(`${config().firestoreBase}/${path.split('/').map(encodeURIComponent).join('/')}`);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw Object.assign(new Error(j.error?.message || `Firestore ${r.status}`), { status: r.status, code: j.error?.status });
  }
  return r.status === 204 ? true : r.json();
}

export const db = {
  /** Document data, or null if it doesn't exist. Throws {status: 403} when rules deny. */
  async get(path) {
    const d = await request('GET', path);
    return d ? decFields(d.fields) : null;
  },
  /** Create-or-replace. `{ mustNotExist: true }` makes it a create-only write. */
  async set(path, data, { mustNotExist = false } = {}) {
    const params = mustNotExist ? [['currentDocument.exists', 'false']] : [];
    await request('PATCH', path, { body: { fields: encFields(data) }, params });
  },
  /** Update only the given top-level fields. */
  async merge(path, data) {
    const params = Object.keys(data).map((k) => ['updateMask.fieldPaths', k]);
    await request('PATCH', path, { body: { fields: encFields(data) }, params });
  },
  async list(collectionPath) {
    const out = [];
    let pageToken = '';
    do {
      const params = [['pageSize', '300']];
      if (pageToken) params.push(['pageToken', pageToken]);
      const r = await request('GET', collectionPath, { params });
      for (const d of r?.documents || []) out.push({ id: docId(d.name), ...decFields(d.fields) });
      pageToken = r?.nextPageToken || '';
    } while (pageToken);
    return out;
  },
  async delete(path) {
    await request('DELETE', path);
  },
};
