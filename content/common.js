// Shared helpers for the per-game detectors (isolated world).
// Exposes `window.DailyTracker` with:
//   register(gameId, detect)   detect(t) returns { completed: true, result, source } or null
//   plus the helpers on `t` below: readKeys, get, walk, dateOf, freshness, isFresh,
//   normalizeStatus, genericStatus, findVisibleText, scanAll
//
// DEBUGGING: on a game page, run `localStorage.setItem('dgt-debug', '1')` in DevTools and
// reload. Every detection pass is then logged to the console as [DailyTracker], along with
// a dump of the localStorage keys. Use that to find the right keys if a site changes its
// format.
(() => {
  if (window.DailyTracker) return;

  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayISO = () => isoOf(new Date());

  const debugOn = (() => {
    try { return localStorage.getItem('dgt-debug') === '1'; } catch { return false; }
  })();
  const log = (...a) => debugOn && console.log('%c[DailyTracker]', 'color:#4ade80;font-weight:bold', ...a);

  // ---- localStorage reading -------------------------------------------------
  function parse(raw) {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch { return raw; }
  }

  /** All localStorage entries whose key matches `re`, JSON-parsed when possible. */
  function readKeys(re) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && re.test(key)) out.push({ key, value: parse(localStorage.getItem(key)) });
    }
    return out;
  }

  const get = (key) => parse(localStorage.getItem(key));

  /** Depth-first walk over plain objects/arrays. Also descends into JSON-encoded strings. */
  function walk(node, visit, depth = 0, seen = new Set()) {
    if (depth > 10 || node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const [k, v] of Object.entries(node)) {
      let child = v;
      if (typeof v === 'string' && v.length > 1 && (v[0] === '{' || v[0] === '[')) {
        child = parse(v);
      }
      visit(k, child, node);
      walk(child, visit, depth + 1, seen);
    }
  }

  // ---- Date / freshness -----------------------------------------------------
  const TS_KEY = /(time|stamp|date|day|ts|last|updated|played|completed|solved|won|_at|At)$/i;

  /** Local YYYY-MM-DD for a date-ish value, or null. Numbers only count under date-ish keys. */
  function dateOf(value, key = '') {
    if (typeof value === 'number' && TS_KEY.test(key)) {
      let ms = null;
      if (value > 1e12 && value < 4e12) ms = value;          // epoch ms
      else if (value > 1e9 && value < 4e9) ms = value * 1000; // epoch s
      return ms ? isoOf(new Date(ms)) : null;
    }
    if (typeof value === 'string') {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?=$|[T ])/);
      if (!m) return null;
      // Full timestamps with a zone → convert to local date; bare dates are already local.
      if (/T.*(Z|[+-]\d\d:?\d\d)$/.test(value)) {
        const d = new Date(value);
        return isNaN(d) ? null : isoOf(d);
      }
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    return null;
  }

  /** 'today' if any date in `obj` is today, 'stale' if it has dates but none today, else 'unknown'. */
  function freshness(obj) {
    const today = todayISO();
    let sawDate = false, sawToday = false;
    const check = (k, v) => {
      const d = dateOf(v, k);
      if (d) { sawDate = true; if (d === today) sawToday = true; }
    };
    if (obj && typeof obj === 'object') walk(obj, check); else check('', obj);
    return sawToday ? 'today' : sawDate ? 'stale' : 'unknown';
  }

  /**
   * Can we trust a "won" state as today's?
   * Today's date inside it → yes. Undated → only if the page wrote it just now (live).
   */
  function isFresh(obj, live) {
    const f = freshness(obj);
    return f === 'today' || (f === 'unknown' && live);
  }

  // ---- Generic status sniffing ----------------------------------------------
  const WIN = /^(win|won|winner|solved|complete|completed|finished|success|victory)$/i;
  const FAIL = /^(fail|failed|failure|lose|lost|loss|gameover|game_over)$/i;
  const STATUS_KEY = /^(status|gamestatus|game_status|state|gamestate|result|outcome|winstate)$/i;
  const BOOL_KEY = /^(solved|issolved|completed|iscompleted|iscomplete|complete|won|iswon|haswon|isfinished|finished|gamewon|puzzlecomplete|puzzlesolved)$/i;

  function normalizeStatus(s) {
    if (typeof s !== 'string') return null;
    if (WIN.test(s)) return 'win';
    if (FAIL.test(s)) return 'fail';
    return null;
  }

  /** Looks for status-ish fields ("status": "WIN", "solved": true, ...) anywhere in obj. */
  function genericStatus(obj) {
    let result = null;
    walk(obj, (k, v) => {
      if (result === 'win') return;
      if (STATUS_KEY.test(k)) {
        const s = normalizeStatus(v);
        if (s === 'win') result = 'win';
        else if (s === 'fail' && !result) result = 'fail';
      } else if (BOOL_KEY.test(k) && v === true) {
        result = 'win';
      }
    });
    return result;
  }

  /**
   * Generic fallback: scan every localStorage key matching `keyRe` for a fresh win/fail.
   * `changedKey` + `live` let a just-written key count even if it carries no date.
   */
  function scanAll(keyRe, { live = false, changedKey = null } = {}) {
    for (const { key, value } of readKeys(keyRe)) {
      if (!value || typeof value !== 'object') continue;
      const status = genericStatus(value);
      if (!status) continue;
      if (isFresh(value, live && key === changedKey)) {
        return { completed: true, result: status, source: `storage:${key}` };
      }
    }
    return null;
  }

  // ---- DOM helpers ----------------------------------------------------------
  const isVisible = (el) => !!(el && (el.offsetParent !== null || el.getClientRects().length));

  /** First visible element matching `selector` whose text matches `re`. */
  function findVisibleText(selector, re) {
    for (const el of document.querySelectorAll(selector)) {
      if (isVisible(el) && re.test(el.textContent || '')) return el;
    }
    return null;
  }

  // ---- Result details (shown to friends who finished the same game) --------------
  // A detail is { summary, grid }: a short score like "4/6" and an emoji grid. Both are
  // spoiler-free by design. No letters, words or answers are ever kept.
  const PICTO = /\p{Extended_Pictographic}/u;

  /** Emoji symbols in a line, one entry per symbol (variation selectors dropped). */
  const pictos = (line) => Array.from(line).filter((ch) => PICTO.test(ch));

  /** Keep only the emoji-grid lines of a share text: lines with emoji and no letters. */
  function emojiGrid(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/[A-Za-z]/.test(l) && pictos(l).length)
      .slice(0, 12)
      .join('\n');
  }

  /** Fallback share parser: any "N/M" score plus the emoji grid. */
  function defaultShare(text) {
    const grid = emojiGrid(text);
    if (!grid) return null;
    const m = text.match(/(?:^|\s)([X\d]{1,2})\/(\d{1,2})(?=\s|$)/m);
    return {
      result: m ? (m[1] === 'X' ? 'fail' : 'win') : 'done',
      summary: m ? `${m[1]}/${m[2]}` : '',
      grid,
    };
  }

  const helpers = {
    todayISO, readKeys, get, walk, dateOf, freshness, isFresh,
    normalizeStatus, genericStatus, scanAll, findVisibleText, isVisible, log,
    emojiGrid, pictos,
  };

  // ---- Watcher loop ---------------------------------------------------------
  /**
   * @param detect      (t) => { completed, result, source, detail? } | null
   * @param parseShare  optional (text, t) => { result, summary, grid } | null, run on the
   *                    text the game copies when the player clicks its Share button.
   */
  function register(gameId, detect, { parseShare } = {}) {
    let reportedFor = null; // date we last reported completion for
    let detailFor = null;   // date we last reported a result detail for
    let pending = null;     // { live, key }
    let timer = null;
    let lastRun = 0;
    let dead = false;

    if (debugOn) {
      const dump = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        dump[k] = parse(localStorage.getItem(k));
      }
      log(`${gameId}: localStorage snapshot`, dump);
    }

    function run() {
      timer = null;
      lastRun = Date.now();
      const ctx = pending || { live: false, key: null };
      pending = null;
      const today = todayISO();
      // Done for the day once we've reported both the completion and its detail.
      if (dead || (reportedFor === today && detailFor === today)) return;

      let res = null;
      try {
        res = detect({ ...helpers, live: ctx.live, changedKey: ctx.key });
      } catch (e) {
        log(`${gameId}: detector threw`, e);
      }
      log(`${gameId}: pass (live=${ctx.live}, key=${ctx.key})`, res);
      if (!res || !res.completed) return;
      // Report the first completion, and again if a detail turns up later (e.g. the board
      // finished rendering after storage already said "won").
      if (reportedFor !== today || (res.detail && detailFor !== today)) report(res);
    }

    // Coalesce bursts of triggers; never run more than ~once per 750ms.
    function schedule(live = false, key = null) {
      if (dead) return;
      pending = {
        live: (pending?.live || false) || live,
        key: live ? key : (pending?.key ?? null),
      };
      if (timer) return;
      const wait = Math.max(150, 750 - (Date.now() - lastRun));
      timer = setTimeout(run, wait);
    }

    function report(res) {
      const date = todayISO();
      const prev = { reportedFor, detailFor };
      reportedFor = date;
      if (res.detail) detailFor = date;
      const undo = () => { ({ reportedFor, detailFor } = prev); };
      try {
        chrome.runtime
          .sendMessage({
            type: 'GAME_COMPLETED', gameId, date,
            result: res.result || 'done',
            source: res.source || 'unknown',
            detail: res.detail || null,
          })
          .then((r) => { if (!r?.ok) undo(); })
          .catch(undo);
        log(`${gameId}: reported completion`, res);
      } catch {
        // "Extension context invalidated": the extension was reloaded under this tab.
        shutdown();
      }
    }

    function shutdown() {
      dead = true;
      observer.disconnect();
      clearInterval(interval);
    }

    // 1) Page's own localStorage writes (via page-hook.js). Most reliable signal.
    window.addEventListener('__dgt_storage', (e) => schedule(true, e.detail));
    // 1b) The player clicked the game's Share button (via page-hook.js).
    window.addEventListener('__dgt_share', (e) => {
      if (dead) return;
      let parsed = null;
      try { parsed = (parseShare || defaultShare)(String(e.detail || ''), helpers); } catch (err) { log(`${gameId}: share parser threw`, err); }
      log(`${gameId}: share captured`, parsed);
      if (!parsed || !(parsed.grid || parsed.summary)) return;
      report({
        completed: true,
        result: parsed.result || 'done',
        source: 'share',
        detail: { summary: parsed.summary || '', grid: parsed.grid || '' },
      });
    });
    // 2) Writes from other tabs on the same site.
    window.addEventListener('storage', (e) => schedule(true, e.key));
    // 3) DOM changes (result modals, board state).
    const observer = new MutationObserver(() => schedule(false));
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-state', 'aria-label'] });
    // 4) Slow safety-net poll, plus re-checks after the SPA hydrates.
    const interval = setInterval(() => { if (!document.hidden) schedule(false); }, 15000);
    [0, 1500, 4000].forEach((ms) => setTimeout(() => schedule(false), ms));
  }

  window.DailyTracker = { register, ...helpers };
})();
