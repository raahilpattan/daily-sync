// Strands: https://www.nytimes.com/games/strands
DailyTracker.register('strands', (t) => {
  // --- 1) localStorage --------------------------------------------------------
  // Strands state usually lives under a key containing "strands"
  // (e.g. "nyt-strands-state", "games-state-strands/<user>"). Strands has no fail state;
  // any "complete/solved" flag dated today counts.
  // 👉 PATCH HERE with the exact key/field once confirmed via dgt-debug.
  const hit = t.scanAll(/strands/i, t);
  if (hit) return { ...hit, result: 'win' }; // Strands can't be lost, so finished = solved

  // --- 2) DOM: completion screen ---------------------------------------------------
  // Finishing shows a results modal ("Share your results" / "Next puzzle in"), and
  // afterwards the board offers a "View Results" button.
  if (t.findVisibleText('[role="dialog"], [class*="modal" i], [class*="results" i]', /(next puzzle in|share (your )?results)/i) ||
      t.findVisibleText('button', /^\s*view results\s*$/i)) {
    return { completed: true, result: 'win', source: 'dom:results' };
  }

  return null;
}, {
  // Share text looks like "Strands #250 / “Theme” / 🔵🔵🟡🔵 / 💡🔵🔵".
  // 🔵 is a theme word, 🟡 the spangram, 💡 a hint.
  // The theme line has letters, so emojiGrid() drops it (no spoilers).
  parseShare(text, t) {
    if (!/strands/i.test(text)) return null;
    const grid = t.emojiGrid(text);
    if (!grid) return null;
    const hints = t.pictos(grid).filter((c) => c === '💡').length;
    return { result: 'win', summary: hints ? `${hints} hint${hints === 1 ? '' : 's'}` : 'No hints', grid };
  },
});
