# Daily Games Tracker (Chrome, Manifest V3)

A toolbar popup that tracks whether you've finished today's **Wordle, Connections, Strands, The Mini, Globle, Worldle and Krillion**. It detects completion on its own while you play, and resets at local midnight. An optional Friends tab shows a daily leaderboard.

Open source under the [MIT License](LICENSE). Website and privacy policy: https://raahilpattan.github.io/daily-sync/

Not affiliated with The New York Times, Globle, Worldle (teuteuf) or Krillion.

## Install (unpacked)

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension. The badge shows how many games are left (✓ when all seven are done).

## How it works

| Piece | Role |
|---|---|
| `content/page-hook.js` | Runs in the page's MAIN world and wraps `localStorage.setItem`, so the tracker knows the moment a game saves state. The `storage` event only fires in *other* tabs, so it can't do this. |
| `content/common.js` | `DailyTracker` helpers plus the watcher loop. It re-runs detection on storage writes, DOM changes, page load and a 15s poll, then messages the worker once. |
| `content/games/*.js` | One detector per game: known localStorage format, then DOM signals (board or results modal), then a generic scan for `status: "WIN"`, `solved: true` and similar. |
| `background.js` | The only writer to `chrome.storage.local`. It runs a one-shot alarm at local midnight that wipes the day and re-arms. Every read also checks the date, so a missed alarm (asleep or closed) can't leave stale ticks. |
| `popup.*` | The widget, with **My Games** and **Friends** tabs. It live-updates through `chrome.storage.onChanged`. Click a game's circle to mark it done or undo. |
| `friends.js` | Friends tab UI. It only messages the service worker and renders the replies. |
| `shared/firebase.js`, `shared/social.js` | Google sign-in, a Firebase Auth + Firestore REST client, and the friends/leaderboard logic. Used only by the service worker. |

A "won" state only counts if it carries today's date, or if it carries no date and the page wrote it just now. That keeps yesterday's leftover state from ticking today's box.

Permissions: `storage`, `alarms` and `identity`. Content scripts are limited to the seven game URLs.

## Friends leaderboard: one-time setup

Fill in two placeholders: the OAuth client ID in `manifest.json` and the Firebase keys in `firebase-config.js`. Until then, the Friends tab shows a "not set up yet" notice and everything else works.

The manifest's `"key"` pins the extension ID to **`dcklimnifkhdpgnopgcfoncjpihpnhgp`** on every machine, so a single OAuth client works for everyone who loads this folder.

### 1. Firebase project
1. In the [Firebase console](https://console.firebase.google.com/), click **Add project**.
2. Go to **Build → Authentication → Get started → Sign-in method** and enable **Google**.
3. Go to **Build → Firestore Database → Create database** and choose production mode.
4. In **Firestore → Rules**, paste [`firestore.rules`](firestore.rules) and click **Publish**.
5. Go to **Project settings → General → Your apps** and add a **Web app**. Copy `apiKey` and `projectId` into [`firebase-config.js`](firebase-config.js).

### 2. Google Cloud OAuth client (Chrome Extension type)
1. Open the [Google Cloud Console](https://console.cloud.google.com/) and select **the same project Firebase created**. This is required, because Firebase only accepts Google tokens issued to its own project.
2. Go to **APIs & Services → OAuth consent screen**. Set it up as **External**, add your app name and support email, and add the `userinfo.email` and `userinfo.profile` scopes. While it's in **Testing**, add yourself and your friends as **Test users**.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   - Application type: **Chrome Extension**
   - Item ID: `dcklimnifkhdpgnopgcfoncjpihpnhgp`
4. Copy the client ID (`….apps.googleusercontent.com`) into `manifest.json` under `oauth2.client_id`.
5. Reload the extension in `chrome://extensions`.

`chrome.identity.getAuthToken` works in Google Chrome only. Chromium forks like Brave and Edge don't support it.

### How friends work
- Everyone gets a 6-character **friend code**, shown on the Friends tab (click to copy). You can add someone by code or by the email they signed in with.
- Friendship is **mutual**. You see someone's progress only after you've added each other. One-way adds show under "Waiting for them to add you back". This is enforced by the Firestore rules, so knowing someone's email isn't enough to watch their stats.
- Whenever a game is ticked or unticked, the service worker writes your progress to Firestore. Signing in uploads today's progress straight away.

### Firestore schema
```
users/{uid}                          { uid, displayName, email, photoURL, friendCode, createdAt, updatedAt }
users/{uid}/dailyStats/{YYYY-MM-DD}  { date, completed: { wordle: { result, at }, … }, count, total, updatedAt }
users/{uid}/friends/{friendUid}      { uid, displayName, photoURL, addedAt }   ← people this user added
friendCodes/{CODE}                   { uid, displayName, photoURL }            ← lookup by code (get only)
emailIndex/{email}                   { uid, displayName, photoURL }            ← lookup by exact email (get only)
```

Why it uses REST instead of the Firebase JS SDK: MV3 bans remotely hosted code, so the SDK would need an npm bundling step. The full Firestore SDK also needs `XMLHttpRequest`, which MV3 service workers don't have. `shared/firebase.js` calls the same Firebase Auth and Firestore APIs with `fetch`, so the security rules work the same way.

## Contributing

Issues and pull requests are welcome. The most useful contributions are fixes to game detectors when a site changes its storage format (see below), and detectors for new daily games:

1. Add an entry to `GAMES` in `shared/games.js`.
2. Add `content/games/<id>.js`, calling `DailyTracker.register('<id>', detect)`.
3. Add a `content_scripts` entry, and the URL in the `page-hook.js` entry, in `manifest.json`.

## Forking with your own backend

`firebase-config.js` and the `oauth2.client_id` in `manifest.json` point at this project's Firebase and Google sign-in setup. That's fine to load as-is for development. If you publish your own fork, create your own Firebase project and OAuth client using the setup steps above. Also remove or replace the manifest `"key"`, so your extension gets its own ID. None of these values are secrets, because access is enforced by `firestore.rules`.

## Publishing

- `docs/` holds the public homepage and privacy policy, served by GitHub Pages at https://raahilpattan.github.io/daily-sync/. Google needs them before the OAuth app can go to Production.
- `scripts/build-store.ps1` builds the Chrome Web Store zip into `dist/`. It strips `"key"` and can swap in the store's OAuth client ID with `-ClientId`.
- `store/` holds the screenshots and `LISTING.md`, which has the listing text, permission justifications, privacy form answers and the full launch checklist.

## If a game stops being detected

Sites change their storage formats. To find the new keys:

1. Open the game, then in DevTools run `localStorage.setItem('dgt-debug', '1')` and reload.
2. The console logs a full localStorage snapshot and every detection pass, tagged `[DailyTracker]`.
3. Patch the matching `content/games/<game>.js` at the `👉 PATCH HERE` comment, then hit reload in `chrome://extensions`.

## Confidence per game

- **Globle and Worldle**: known formats (`statistics.lastWin`; `guesses["YYYY-MM-DD"]` with `distance === 0`).
- **Wordle**: `nyt-wordle-moogle/*` / `nyt-wordle-state` status, plus reading the board tiles from the DOM.
- **Krillion**: `krillion:stats:v1` → `history["YYYY-MM-DD"]`, read from the site's own code. Krillion's day rolls over at midnight New York time, but this tracker resets at your local midnight, so the two can differ by a few hours if you live outside Eastern time.
- **Connections, Strands, Mini**: NYT's keys for these aren't stable, so they lean on DOM signals ("Next puzzle in", "View Results", the Mini congrats modal) plus the generic scanner. These are the most likely to need a patch.
