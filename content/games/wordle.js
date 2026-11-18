// Wordle: https://www.nytimes.com/games/wordle/
(() => {
  // Tile colours for the spoiler-free grid (same as Wordle's own Share text, dark mode).
  const EMO = { correct: '🟩', present: '🟨', absent: '⬛' };

  /** Build { summary: "4/6" | "X/6", grid } from rows of tile states. */
  function toDetail(rows) {
    const lines = [];
    let won = false;
    for (const states of rows) {
      if (states.length !== 5 || !states.every((s) => EMO[s])) break; // stop at the first unplayed row
      lines.push(states.map((s) => EMO[s]).join(''));
      if (states.every((s) => s === 'correct')) { won = true; break; }
    }
    if (!lines.length || (!won && lines.length < 6)) return null; // game not over yet
    return { summary: won ? `${lines.length}/6` : 'X/6', grid: lines.join('\n') };
  }

  /** Tile states read from the page. The page always shows today's board. */
  function domRows() {
    return [...document.querySelectorAll('[class*="Row-module_row"]')].map((row) =>
      [...row.querySelectorAll('[data-state]')].map((el) => el.dataset.state));
  }

  /** Tile states from a saved state object, if it has an `evaluations` array. */
  function storageRows(t, value) {
    let rows = null;
    t.walk(value, (k, v) => {
      if (!rows && k === 'evaluations' && Array.isArray(v)) rows = v.filter(Array.isArray);
    });
    return rows;
  }

  DailyTracker.register('wordle', (t) => {
    // --- 1) localStorage --------------------------------------------------------
    // Known formats (NYT has changed this several times):
    //   current: "nyt-wordle-moogle/ANON" or "nyt-wordle-moogle/<userId>"
    //            { game: { status: "WIN" | "FAIL" | "IN_PROGRESS", ... }, timestamp, ... }
    //   legacy : "nyt-wordle-state"
    //            { gameStatus: "WIN" | "FAIL" | "IN_PROGRESS", evaluations, lastCompletedTs, ... }
    // 👉 PATCH HERE if NYT renames the key or field: adjust the regex / `status` lookup.
    for (const { key, value } of t.readKeys(/wordle/i)) {
      if (!value || typeof value !== 'object') continue;
      const status = t.normalizeStatus(value?.game?.status ?? value?.gameStatus) ?? t.genericStatus(value);
      if (status && t.isFresh(value, t.live && key === t.changedKey)) {
        const rows = storageRows(t, value);
        const detail = (rows && toDetail(rows)) || toDetail(domRows());
        return { completed: true, result: status, source: `storage:${key}`, detail };
      }
    }

    // --- 2) DOM: read the board ----------------------------------------------------
    // Tiles carry data-state = empty | tbd | absent | present | correct.
    // 👉 PATCH HERE if the CSS-module class names change.
    const detail = toDetail(domRows());
    if (detail) {
      return { completed: true, result: detail.summary === 'X/6' ? 'fail' : 'win', source: 'dom:board', detail };
    }

    return null;
  }, {
    // "Wordle 1,234 4/6*\n\n⬛🟨⬛⬛⬛\n…"
    parseShare(text, t) {
      const m = text.match(/Wordle\s+[\d,.\s]+?\s([X\d])\/6(\*?)/i);
      const grid = t.emojiGrid(text);
      if (!m || !grid) return null;
      return { result: m[1] === 'X' ? 'fail' : 'win', summary: `${m[1]}/6${m[2]}`, grid };
    },
  });
})();
