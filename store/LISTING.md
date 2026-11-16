# Chrome Web Store submission kit

Copy-paste material for the Developer Dashboard (https://chrome.google.com/webstore/devconsole).

## Store listing

**Name:** Daily Sync

**Summary** (≤132 chars):
> Track today's Wordle, Connections, Strands, Mini, Globle, Worldle and Krillion at a glance, and compare progress with friends.

**Category:** Fun (alternative: Productivity)

**Description:**
> Daily Sync keeps a running checklist of the daily puzzles you play, and ticks each one off as you finish it.
>
> TRACKED GAMES
> • Wordle, Connections, Strands and The Mini (NYT Games)
> • Globle
> • Worldle
> • Krillion
>
> FEATURES
> • Automatic: finish a puzzle and it's ticked off, with nothing to click.
> • One glance: the toolbar badge shows how many games you have left today.
> • Resets at midnight, ready for the next day's puzzles.
> • Missed one? Click the circle to mark a game done yourself.
> • Optional Friends tab: sign in with Google, add friends by code or email, and see a daily leaderboard of who's finished what.
>
> PRIVACY
> Tracking works entirely in your browser. Nothing is uploaded unless you choose to sign in for the Friends feature, and you can delete your account and all its data from the extension at any time. Friends can only see your progress if you've added them back.
>
> Not affiliated with The New York Times, Globle, Worldle (teuteuf) or Krillion. Game names are used only to identify the games tracked.

**Screenshots** (1280×800): `store/screenshot-games.png`, `store/screenshot-friends.png`

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
| `storage` | Saves today's completion checklist locally, and the user's sign-in session if they use Friends. |
| `alarms` | Schedules the reset at local midnight so a new day starts with an empty checklist. |
| `identity` | Signs the user in with their Google account (only if they open the Friends tab and click Sign in) so their daily progress can be shared with friends they add. |
| Host access (content scripts on nytimes.com/games/…, nytimes.com/crosswords/game/mini, globle-game.com, worldle.teuteuf.fr, krillion.io) | Reads the game's own saved state and visible page on these specific game pages to detect when today's puzzle is finished. No other sites are accessed. |

**Remote code:** No. All JavaScript is included in the package.

**Data usage:** tick these:
- ☑ **Personally identifiable information**: name, email address (only when the user signs in to Friends)
- ☑ **Authentication information**: Google sign-in token, used only to authenticate with Firebase
- ☑ **User activity**: which listed daily games were completed and when (only when signed in)
- ☐ Everything else (health, financial, location, web history, website content, personal communications)

Note on "website content": the extension reads game pages *locally* to detect completion, but only a completed/not-completed flag is ever stored.

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
