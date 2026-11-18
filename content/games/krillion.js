// Krillion: https://krillion.io/  (daily "dive" of 7 timed trivia prompts)
DailyTracker.register('krillion', (t) => {
  // Krillion's day rolls over at midnight America/New_York, not local time.
  const etDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

  // --- 1) localStorage (from the site's bundle, Nov 2026) ----------------------
  //   "krillion:stats:v1"  { history: { "YYYY-MM-DD": { score, results, ... } }, ... }
  //   Signed-in players get a prefixed key: "krillion:account:<uid>:krillion:stats:v1".
  //   "krillion:game:v1" holds the in-progress dive and is cleared when the dive finishes.
  // 👉 PATCH HERE if the key or shape changes.
  for (const { key, value } of t.readKeys(/krillion:stats:v\d+$/)) {
    const entry = value?.history?.[etDate];
    if (entry) {
      const score = typeof entry === 'object' && Number.isFinite(entry.score) ? entry.score : null;
      const detail = score !== null ? { summary: `Score ${score}`, grid: '' } : null;
      return { completed: true, result: 'done', source: `storage:${key}`, detail };
    }
  }

  // --- 2) DOM: end-of-dive screen ("Dive #123 complete") -----------------------------
  if (location.pathname === '/' && t.findVisibleText('span, h1, h2, div', /^\s*dive #\d+ complete\s*$/i)) {
    return { completed: true, result: 'done', source: 'dom:dive-complete' };
  }

  return null;
}, {
  // Only trust share text that names Krillion, then keep any "N/M" score and emoji lines.
  parseShare(text, t) {
    if (!/krillion/i.test(text)) return null;
    const grid = t.emojiGrid(text);
    const m = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s|$)/m);
    if (!grid && !m) return null;
    return { result: 'done', summary: m ? `${m[1]}/${m[2]}` : '', grid };
  },
});
