# Daily Games Tracker (Chrome, Manifest V3)

A toolbar popup that tracks whether you've finished today's **Wordle, Connections, Strands, The Mini, Globle, Worldle and Krillion**. It detects completion on its own while you play, and resets at local midnight.

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
| `popup.*` | The dark widget. It live-updates through `chrome.storage.onChanged`. Hover a row for a **Mark done / Undo** override. |

A "won" state only counts if it carries today's date, or if it carries no date and the page wrote it just now. That keeps yesterday's leftover state from ticking today's box.

Permissions: `storage` and `alarms` only. Content scripts are limited to the seven game URLs.

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
