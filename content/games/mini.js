// The Mini Crossword: https://www.nytimes.com/crosswords/game/mini
// (Archive URLs like /crosswords/game/mini/2026/11/10 are excluded in manifest.json.)
DailyTracker.register('mini', (t) => {
  // --- 1) DOM: the main signal ---------------------------------------------------
  // The crossword keeps progress in IndexedDB / on NYT's servers rather than in plain
  // localStorage, so the solved state is easiest to read from the page:
  //   • congrats modal: "Congratulations!" / "You solved The Mini in 0:42"
  //   • the toolbar timer shows a solved state once finished
  // 👉 PATCH HERE if NYT renames these classes.
  const congrats = t.findVisibleText(
    '[class*="congrats" i], [role="dialog"], [class*="modal" i]',
    /(you solved|congratulations|you did it)/i,
  );
  if (congrats) return { completed: true, result: 'win', source: 'dom:congrats' };

  if (document.querySelector('[class*="board--solved" i], [class*="puzzle--solved" i], [class*="timer"][class*="solved" i]')) {
    return { completed: true, result: 'win', source: 'dom:solved-class' };
  }

  // --- 2) localStorage fallback ---------------------------------------------------
  // Covers any future move of crossword state into localStorage.
  return t.scanAll(/(mini|crossword|xwd)/i, t);
});
