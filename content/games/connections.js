// Connections: https://www.nytimes.com/games/connections
DailyTracker.register('connections', (t) => {
  // --- 1) localStorage --------------------------------------------------------
  // NYT's key for Connections isn't stable (seen: "nyt-connections", "nyt-connections-beta",
  // per-user "games-state-connections/..." variants). We scan anything mentioning
  // connections for a status/solved flag dated today.
  // 👉 PATCH HERE once you've confirmed the key with dgt-debug, e.g.:
  //    const s = t.get('nyt-connections-beta'); if (s?.puzzleComplete && t.isFresh(s, t.live)) ...
  for (const { key, value } of t.readKeys(/connections/i)) {
    if (!value || typeof value !== 'object') continue;
    const generic = t.genericStatus(value);
    const groups = groupsStatus(value);
    if (!generic && !groups) continue;
    if (!t.isFresh(value, t.live && key === t.changedKey)) continue;
    // Mistakes/groups say how it actually went. A generic "win" is only trusted if
    // nothing contradicts it, and is otherwise reported as plain "done" (shown as
    // "Completed"), never as "Solved". Clicking Share gives the exact result.
    const result = groups ?? (generic === 'fail' ? 'fail' : 'done');
    return { completed: true, result, source: `storage:${key}` };
  }

  // --- 2) DOM: results screen ---------------------------------------------------
  // After finishing (win or lose), NYT shows a results modal with a "Next puzzle in"
  // countdown, and the board gets a "View Results" button.
  if (t.findVisibleText('[role="dialog"], [class*="modal" i], [class*="results" i]', /next puzzle in/i) ||
      t.findVisibleText('button', /^\s*view results\s*$/i)) {
    return { completed: true, result: 'done', source: 'dom:results' };
  }

  return null;

  // Heuristic: 0 mistakes remaining = out of lives (a loss, checked first, because NYT
  // reveals the remaining groups when you lose); otherwise 4 found groups = solved.
  function groupsStatus(obj) {
    let lost = false, won = false;
    t.walk(obj, (k, v) => {
      if (/^mistakesremaining$/i.test(k) && v === 0) lost = true;
      if (/^(mistakes|mistakesmade|mistakecount)$/i.test(k) && v >= 4) lost = true;
      if (/^(solvedcategories|groupsfound|solvedgroups|foundgroups)$/i.test(k) && Array.isArray(v) && v.length >= 4) won = true;
    });
    return lost ? 'fail' : won ? 'win' : null;
  }
}, {
  // Share text looks like "Connections / Puzzle #512 / 🟨🟨🟨🟨 / 🟩🟪🟩🟩 / …",
  // with one emoji line per guess.
  // A single-colour line is a solved group; anything else is a mistake.
  parseShare(text, t) {
    if (!/connections/i.test(text)) return null;
    const grid = t.emojiGrid(text);
    const rows = grid.split('\n').map(t.pictos).filter((r) => r.length === 4);
    if (!rows.length) return null;
    const solved = rows.filter((r) => r.every((c) => c === r[0])).length;
    const mistakes = rows.length - solved;
    const won = solved >= 4;
    const summary = won
      ? (mistakes ? `${mistakes} mistake${mistakes === 1 ? '' : 's'}` : 'Perfect')
      : `${solved}/4 groups`;
    return { result: won ? 'win' : 'fail', summary, grid };
  },
});
