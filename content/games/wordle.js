// Wordle: https://www.nytimes.com/games/wordle/
DailyTracker.register('wordle', (t) => {
  // --- 1) localStorage --------------------------------------------------------
  // Known formats (NYT has changed this several times):
  //   current: "nyt-wordle-moogle/ANON" or "nyt-wordle-moogle/<userId>"
  //            { game: { status: "WIN" | "FAIL" | "IN_PROGRESS", ... }, timestamp, ... }
  //   legacy : "nyt-wordle-state"
  //            { gameStatus: "WIN" | "FAIL" | "IN_PROGRESS", lastCompletedTs, lastPlayedTs, ... }
  // 👉 PATCH HERE if NYT renames the key or field: adjust the regex / `status` lookup.
  for (const { key, value } of t.readKeys(/wordle/i)) {
    if (!value || typeof value !== 'object') continue;
    const status = t.normalizeStatus(value?.game?.status ?? value?.gameStatus) ?? t.genericStatus(value);
    if (status && t.isFresh(value, t.live && key === t.changedKey)) {
      return { completed: true, result: status, source: `storage:${key}` };
    }
  }

  // --- 2) DOM: read the board ----------------------------------------------------
  // The page always shows *today's* board, so this can't be stale.
  // Tiles carry data-state = empty | tbd | absent | present | correct.
  // 👉 PATCH HERE if the CSS-module class names change.
  const rows = [...document.querySelectorAll('[class*="Row-module_row"]')];
  if (rows.length) {
    let filled = 0;
    for (const row of rows) {
      const states = [...row.querySelectorAll('[data-state]')].map((el) => el.dataset.state);
      if (states.length !== 5) continue;
      if (states.every((s) => s === 'correct')) return { completed: true, result: 'win', source: 'dom:board' };
      if (states.every((s) => s === 'absent' || s === 'present' || s === 'correct')) filled++;
    }
    if (filled === 6) return { completed: true, result: 'fail', source: 'dom:board' };
  }

  return null;
});
