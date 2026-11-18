// Globle: https://globle-game.com/
DailyTracker.register('globle', (t) => {
  const today = t.todayISO();

  // --- 1) Known format ------------------------------------------------------------
  //   "statistics": { gamesWon, lastWin: "YYYY-MM-DD", currentStreak, maxStreak, usedGuesses, ... }
  //   "guesses":    { day: "YYYY-MM-DD", countries: [...] }
  // Globle has unlimited guesses, so "won today" == "completed today".
  // 👉 PATCH HERE if the key names change.
  const guesses = t.get('guesses');
  const todaysGuesses = guesses && typeof guesses === 'object' && t.dateOf(guesses.day) === today ? guesses : null;
  const n = Array.isArray(todaysGuesses?.countries) ? todaysGuesses.countries.length : 0;
  const detail = n ? { summary: `${n} guess${n === 1 ? '' : 'es'}`, grid: '' } : null;

  const stats = t.get('statistics');
  if (stats && typeof stats === 'object' && t.dateOf(stats.lastWin) === today) {
    return { completed: true, result: 'win', source: 'storage:statistics.lastWin', detail };
  }

  if (todaysGuesses) {
    const status = t.genericStatus(todaysGuesses);
    if (status) return { completed: true, result: status, source: 'storage:guesses', detail };
  }

  // --- 2) DOM: win banner ------------------------------------------------------------
  if (t.findVisibleText('p, h2, h3, [class*="win" i]', /the mystery country is/i)) {
    return { completed: true, result: 'win', source: 'dom:win-banner', detail };
  }

  // --- 3) Generic fallback (dedicated domain, so scan every key) ---------------------
  return t.scanAll(/./, t);
}, {
  // Share text looks like "🌎 Nov 16, 2026 🌍 / 🔥 3 | Avg. Guesses: 5.2 / 🟥🟧🟨🟩 = 4 / globle-game.com".
  parseShare(text, t) {
    const m = text.match(/=\s*(\d+)/);
    if (!m || !/globle/i.test(text)) return null;
    const n = Number(m[1]);
    return { result: 'win', summary: `${n} guess${n === 1 ? '' : 'es'}`, grid: t.emojiGrid(text) };
  },
});
