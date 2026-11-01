// YT Quick Hide: page-context half of the speed controller (see speed.js).
// Hooks play() so speed.js also covers audio the page never adds to the
// document (new Audio()) and media inside shadow DOM.

(() => {
  let rate = null; // speed from speed.js; null while the controller is off
  const detached = new Set(); // WeakRefs to playing media outside the document

  const each = (fn) => {
    for (const ref of detached) {
      const el = ref.deref();
      if (!el || el.isConnected) detached.delete(ref);
      else fn(el);
    }
  };

  document.addEventListener('ytqh-speed', (e) => {
    rate = e.detail;
    if (rate) each((el) => { el.playbackRate = rate; });
  });
  document.addEventListener('ytqh-seek', (e) => {
    each((el) => { el.currentTime = Math.max(0, el.currentTime + e.detail); });
  });

  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try {
      if (!this.isConnected) {
        if (![...detached].some((ref) => ref.deref() === this)) detached.add(new WeakRef(this));
        if (rate && rate !== 1) this.playbackRate = rate;
        document.dispatchEvent(new Event('ytqh-detached'));
      } else if (this.getRootNode() !== document) {
        this.dispatchEvent(new Event('ytqh-media', { bubbles: true, composed: true }));
      }
    } catch {}
    return play.apply(this, arguments);
  };

  // Ask speed.js for the current speed in case it loaded first.
  document.dispatchEvent(new Event('ytqh-speed-hello'));
})();
