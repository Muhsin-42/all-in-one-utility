// Browser Kit: shows dislike counts again, using the Return YouTube Dislike
// API (returnyoutubedislikeapi.com). Runs after settings.js, which sets the
// ytqh-dislikes flag on <html> while the switch is on. The request goes through
// background.js so the page's CORS rules don't apply.

(() => {
  if (window !== top) return;

  const root = document.documentElement;
  const MARK = 'ytqh-dislike-count';
  const votes = new Map(); // videoId -> { dislikes, pressed } once fetched, null while pending
  const format = new Intl.NumberFormat(root.lang || undefined, { notation: 'compact', maximumFractionDigits: 1 });

  function videoId() {
    if (location.pathname === '/watch') return new URLSearchParams(location.search).get('v');
    const m = location.pathname.match(/^\/shorts\/([\w-]{11})/);
    return m && m[1];
  }

  // Desktop watch page, then the active Short.
  function findButton() {
    if (location.pathname === '/watch') {
      return document.querySelector(
        'ytd-watch-metadata dislike-button-view-model button, ytd-watch-metadata #segmented-dislike-button button');
    }
    return document.querySelector(
      'ytd-reel-video-renderer[is-active] #dislike-button button, ytd-reel-video-renderer[is-active] dislike-button-view-model button');
  }

  const isPressed = (btn) => btn.getAttribute('aria-pressed') === 'true';

  // Watch page: the dislike button is icon-only, so give it a text slot the
  // way YouTube's own like button has one.
  function showOnWatch(btn, text, title) {
    let slot = btn.querySelector(`[${MARK}]`);
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'yt-spec-button-shape-next__button-text-content';
      slot.setAttribute(MARK, '');
      btn.appendChild(slot);
      btn.classList.replace('yt-spec-button-shape-next--icon-button', 'yt-spec-button-shape-next--icon-leading');
    }
    if (slot.textContent !== text) slot.textContent = text;
    slot.title = title;
  }

  // Shorts: the button already has a "Dislike" label under it; swap its text.
  function showOnShorts(btn, text, title) {
    const label = btn.closest('#dislike-button, dislike-button-view-model')
      ?.querySelector('.yt-spec-button-shape-with-label__label span');
    if (!label) return;
    if (!label.hasAttribute(MARK)) label.setAttribute(MARK, label.textContent);
    if (label.textContent !== text) label.textContent = text;
    label.title = title;
  }

  function clear() {
    document.querySelectorAll(`[${MARK}]`).forEach((el) => {
      if (el.tagName === 'SPAN') {
        el.textContent = el.getAttribute(MARK);
        el.removeAttribute(MARK);
        el.removeAttribute('title');
        return;
      }
      el.closest('button')?.classList.replace(
        'yt-spec-button-shape-next--icon-leading', 'yt-spec-button-shape-next--icon-button');
      el.remove();
    });
  }

  function fetchVotes(id, btn) {
    votes.set(id, null);
    chrome.runtime.sendMessage({ type: 'ytqh-dislikes', videoId: id }, (res) => {
      if (chrome.runtime.lastError || !res || typeof res.dislikes !== 'number') {
        votes.delete(id);
        return;
      }
      // The API's count may not include a vote the user had already cast, so
      // remember the button state now and adjust only for later clicks.
      votes.set(id, { dislikes: res.dislikes, pressed: isPressed(findButton() || btn) });
      tick();
    });
  }

  function tick() {
    if (!root.hasAttribute('ytqh-dislikes')) {
      clear();
      return;
    }
    const id = videoId();
    const btn = id && findButton();
    if (!btn) return;
    if (!votes.has(id)) {
      // A new video: drop the previous one's count while this one loads.
      clear();
      fetchVotes(id, btn);
      return;
    }
    const v = votes.get(id);
    if (!v) return;
    const count = Math.max(0, v.dislikes + (isPressed(btn) - v.pressed));
    const text = format.format(count);
    const title = `${count.toLocaleString()} dislikes (Return YouTube Dislike)`;
    if (location.pathname === '/watch') showOnWatch(btn, text, title);
    else showOnShorts(btn, text, title);
  }

  document.addEventListener('yt-navigate-finish', tick);
  setInterval(tick, 500);
})();
