// Runs in the page's MAIN world at document_start.
// Content scripts (isolated world) can read localStorage, but they can't observe the page's
// own writes: the `storage` event only fires in *other* tabs. So we wrap setItem/removeItem
// and announce each change via a DOM event, which crosses the world boundary.
// Only the key name is sent for storage writes. Share text is handled at the bottom.
(() => {
  if (window.__dailyTrackerHooked) return;
  window.__dailyTrackerHooked = true;

  const proto = Storage.prototype;
  const origSet = proto.setItem;
  const origRemove = proto.removeItem;

  const announce = (storage, key) => {
    if (storage !== window.localStorage) return;
    try {
      window.dispatchEvent(new CustomEvent('__dgt_storage', { detail: String(key) }));
    } catch { /* never break the page */ }
  };

  proto.setItem = function (key, value) {
    const r = origSet.apply(this, arguments);
    announce(this, key);
    return r;
  };
  proto.removeItem = function (key) {
    const r = origRemove.apply(this, arguments);
    announce(this, key);
    return r;
  };

  // ---- Share capture -----------------------------------------------------------
  // When the player clicks the game's own "Share" button, the game copies a spoiler-free
  // result (e.g. "Wordle 1,234 4/6" plus the emoji grid). We pass that text to the content
  // script, which keeps only the score and the emoji lines for the Friends tab.
  const shareOut = (text) => {
    if (typeof text !== 'string' || !text || text.length > 2000) return;
    try { window.dispatchEvent(new CustomEvent('__dgt_share', { detail: text })); } catch { /* never break the page */ }
  };

  try {
    const clip = navigator.clipboard;
    if (clip && clip.writeText) {
      const origWrite = clip.writeText;
      clip.writeText = function (text) { shareOut(text); return origWrite.apply(this, arguments); };
    }
    if (clip && clip.write && window.ClipboardItem) {
      const origWriteItems = clip.write;
      clip.write = function (items) {
        try {
          for (const item of items || []) {
            if (item.types?.includes('text/plain')) item.getType('text/plain').then((b) => b.text()).then(shareOut, () => {});
          }
        } catch { /* ignore */ }
        return origWriteItems.apply(this, arguments);
      };
    }
    if (navigator.share) {
      const origShare = navigator.share;
      navigator.share = function (data) { shareOut(data?.text); return origShare.apply(this, arguments); };
    }
    const origExec = Document.prototype.execCommand;
    Document.prototype.execCommand = function (cmd) {
      if (String(cmd).toLowerCase() === 'copy') {
        const el = document.activeElement;
        shareOut(el && 'value' in el && typeof el.value === 'string' ? el.value : String(window.getSelection() || ''));
      }
      return origExec.apply(this, arguments);
    };
  } catch { /* never break the page */ }
})();
