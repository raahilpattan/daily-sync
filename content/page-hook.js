// Runs in the page's MAIN world at document_start.
// Content scripts (isolated world) can read localStorage, but they can't observe the page's
// own writes: the `storage` event only fires in *other* tabs. So we wrap setItem/removeItem
// and announce each change via a DOM event, which crosses the world boundary.
// Only the key name is sent; no values leave the page.
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
})();
