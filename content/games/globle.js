// Globle: https://globle-game.com/
DailyTracker.register('globle', (t) => {
  const today = t.todayISO();

  // --- 1) Known format ------------------------------------------------------------
  //   "statistics": { gamesWon, lastWin: "YYYY-MM-DD", currentStreak, maxStreak, usedGuesses, ... }
  //   "guesses":    { day: "YYYY-MM-DD", countries: [...] }
  // Globle has unlimited guesses, so "won today" == "completed today".
  // 👉 PATCH HERE if the key names change.
  const stats = t.get('statistics');
  if (stats && typeof stats === 'object' && t.dateOf(stats.lastWin) === today) {
    return { completed: true, result: 'win', source: 'storage:statistics.lastWin' };
  }

  const guesses = t.get('guesses');
  if (guesses && typeof guesses === 'object' && t.dateOf(guesses.day) === today) {
    const status = t.genericStatus(guesses);
    if (status) return { completed: true, result: status, source: 'storage:guesses' };
  }

  // --- 2) DOM: win banner ------------------------------------------------------------
  if (t.findVisibleText('p, h2, h3, [class*="win" i]', /the mystery country is/i)) {
    return { completed: true, result: 'win', source: 'dom:win-banner' };
  }

  // --- 3) Generic fallback (dedicated domain, so scan every key) ---------------------
  return t.scanAll(/./, t);
});
