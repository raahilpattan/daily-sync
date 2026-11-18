# Chrome Web Store submission kit

**Web Store item ID:** `mngaablooeddihemfdmhdjncdkfdkpdf`
**Store build command:**
```
powershell -ExecutionPolicy Bypass -File scripts\build-store.ps1 -ClientId 889622447436-hd0hlr0esblum65nb9snhouqe2muevku.apps.googleusercontent.com
```
Bump `"version"` in `manifest.json` before each new upload.

Copy-paste material for the Developer Dashboard (https://chrome.google.com/webstore/devconsole).

## Store listing

**Name:** Daily Sync

**Summary** (≤132 chars). The store reads this from `"description"` in `manifest.json`, so change it there and re-upload:
> Automatically track your daily puzzle progress, stay organized, and compare results with friends.

**Category:** Fun (alternative: Productivity)

**Description:** paste exactly this. **Don't name any of the games.** Google rejected both a bulleted list of game names and a single sentence naming them as "keyword spam" (violation *Yellow Argon*, Nov 2026). Keep it generic, e.g. "daily word, geography and trivia puzzles".
```
Daily Sync keeps a checklist of the daily puzzles you play and ticks each one off as you finish it, so you can see at a glance what's done and what's left. You can also compare results with friends without spoiling anything.

It works with a handful of popular daily word, geography and trivia puzzles that you play in your browser.

FEATURES

Automatic tracking
Play on each game's own website as usual. Daily Sync notices when you finish today's puzzle and ticks it off. Missed one, or played on your phone? Click the circle to mark it done yourself.

Your day at a glance
The toolbar badge shows how many puzzles you have left. Open the popup to see your progress, your score for each puzzle, and one-click links to the ones you haven't played yet.

Fresh start every day
Your checklist clears at midnight, ready for the next day's puzzles.

Your list, your way
Hide the puzzles you don't play and drag the rest into the order you like. Your progress and badge only count the ones you keep.

Streaks and stats
Keep your streak going! The Stats tab shows your current and best streak, a calendar of the days you played, and your average score for each puzzle.

Friends leaderboard (optional)
Sign in with Google, share your friend code, and add friends by code or email. Once you've added each other, you'll see a daily leaderboard of who has finished what, along with everyone's streak.

Compare results, no spoilers
Click a friend to see their score and emoji grid for each puzzle. Their result stays locked until you've finished that puzzle yourself, so nobody gets spoiled. Most scores are recorded automatically. For a few puzzles, click the game's own Share button to record yours.

PRIVACY
• Tracking happens entirely in your browser, and the extension only runs on the supported game websites.
• Nothing is uploaded unless you sign in for Friends. If you do, your name, email, photo, friend list and daily results are stored so that friends you've both added can see them.
• Only spoiler-free scores and emoji grids are saved, never words or answers.
• You can delete your account and all its data from the extension at any time.
Privacy policy: https://raahilpattan.github.io/daily-sync/privacy.html

GETTING STARTED
1. Install Daily Sync and pin it to your toolbar.
2. Play your daily puzzles as usual.
3. Click the icon to see what's done and what's left.
4. Optionally, open the Friends tab and sign in to compare results.

Daily Sync is an independent, open-source project. It is not affiliated with or endorsed by the makers of any of the supported games.
```

**Screenshots** (1280×800), in this order: `store/screenshot-games.png`, `store/screenshot-stats.png`, `store/screenshot-friends.png`. Their captions don't name any games (same keyword-spam rule as the description).

**Icon:** `icons/icon128.png`, the DS logo with the store's recommended 16px transparent padding. All icon sizes are generated from `store/logo-source.jpg` by `scripts/make-icons.ps1`.

Don't upload the logo to the Google Auth Platform **Branding** page. Adding a logo there triggers Google's brand verification review, which isn't needed for an app that only asks for email and profile.

**Homepage URL:** `https://raahilpattan.github.io/daily-sync/`
**Privacy policy URL:** `https://raahilpattan.github.io/daily-sync/privacy.html`

## Privacy practices tab

**Single purpose:**
> Shows which of the user's daily browser puzzle games they have completed today, and optionally lets them compare that daily progress with friends.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves today's completion checklist and a short daily history (for streaks and stats) locally, the user's list settings (hidden games and order), and their sign-in session if they use Friends. |
| `alarms` | Schedules the reset at local midnight so a new day starts with an empty checklist. |
| `identity` | Signs the user in with their Google account (only if they open the Friends tab and click Sign in) so their daily progress can be shared with friends they add. |
| Host access (content scripts on nytimes.com/games/…, globle-game.com, worldle.teuteuf.fr, krillion.io) | Reads the game's own saved state and visible page on these specific game pages to detect when today's puzzle is finished. When the player clicks the game's own Share button, it keeps the score and emoji grid from the shared text. No other sites are accessed. |

**Remote code:** No. All JavaScript is included in the package.

**Data usage:** tick these:
- ☑ **Personally identifiable information**: name, email address (only when the user signs in to Friends)
- ☑ **Authentication information**: Google sign-in token, used only to authenticate with Firebase
- ☑ **User activity**: which listed daily games were completed, when, and the score/emoji grid (only when signed in)
- ☐ Everything else (health, financial, location, web history, website content, personal communications)

Note on "website content": the extension reads game pages *locally* to detect completion. It only stores a completed flag, the time, and a short spoiler-free score and emoji grid.

**Certifications:** tick all three:
- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

## Launch checklist

1. [ ] Sign-in works end to end with test users (unpacked build).
2. [x] Site lives in `docs/` and is served by GitHub Pages at https://raahilpattan.github.io/daily-sync/.
3. [ ] Verify the site's domain in Google Search Console. Add the `<meta name="google-site-verification">` tag to `docs/index.html`.
4. [ ] Google Auth Platform → **Branding**: add the homepage and privacy URLs, and add the site's domain under Authorized domains. No logo, to avoid brand review.
5. [ ] Google Auth Platform → **Audience** → **Publish app** (moves from Testing to In production).
6. [ ] Pay the one-time $5 Chrome Web Store developer fee.
7. [ ] `scripts\build-store.ps1` → upload `dist\*.zip` as a new item. Save as draft and note the **item ID**.
8. [ ] Google Auth Platform → **Clients** → new **Chrome Extension** client with the store item ID.
9. [ ] `scripts\build-store.ps1 -ClientId <new client id>` → upload the new zip to the same item.
10. [ ] Fill in the listing and privacy tabs from this file, then **Submit for review**.
11. [ ] After approval, point the homepage button in `docs/index.html` at the store listing and relabel it "Add to Chrome".

Keep the dev OAuth client (item ID `dcklimnifkhdpgnopgcfoncjpihpnhgp`) for local testing. Both clients can coexist in the same project.
