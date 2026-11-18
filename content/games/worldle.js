// Worldle: https://worldle.teuteuf.fr/
DailyTracker.register('worldle', (t) => {
  const today = t.todayISO();
  const MAX_GUESSES = 6;

  // --- 1) Known format ------------------------------------------------------------
  //   "guesses": { "YYYY-MM-DD": [ { name, distance, direction }, ... ], ... }
  // A guess with distance 0 is the answer; 6 misses is a loss.
  // Newer builds have used other key names, so check every key for a today-keyed
  // array of guess-like objects.
  // 👉 PATCH HERE if the format changes.
  for (const { key, value } of t.readKeys(/./)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const todays = value[today];
    if (!Array.isArray(todays) || !todays.length || typeof todays[0] !== 'object') continue;
    if (!todays.some((g) => g && 'distance' in g)) continue;

    const winAt = todays.findIndex((g) => g?.distance === 0);
    if (winAt >= 0) {
      return { completed: true, result: 'win', source: `storage:${key}`, detail: { summary: `${winAt + 1}/${MAX_GUESSES}`, grid: '' } };
    }
    if (todays.length >= MAX_GUESSES) {
      return { completed: true, result: 'fail', source: `storage:${key}`, detail: { summary: `X/${MAX_GUESSES}`, grid: '' } };
    }
  }

  // --- 2) Generic fallback --------------------------------------------------------
  return t.scanAll(/./, t);
}, {
  // Share text looks like "#Worldle #123 (16.11.2026) 3/6 (100%) / 🟩🟩🟩🟨⬜⬅️ / 🟩🟩🟩🟩🟩🎉".
  parseShare(text, t) {
    const m = text.match(/#Worldle\b.*?\s([X\d])\/6\b/i);
    if (!m) return null;
    return { result: m[1] === 'X' ? 'fail' : 'win', summary: `${m[1]}/6`, grid: t.emojiGrid(text) };
  },
});
