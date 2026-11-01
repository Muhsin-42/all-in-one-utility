// YT Quick Hide: playback speed controller for every <video> and <audio> on any
// site, like the Video Speed Controller extension. Runs in the extension's own
// context in every frame; speed-main.js (page context) covers the media this
// script can't reach: audio that was never added to the page (new Audio()) and
// media inside shadow DOM.
//
// Keys: S slower, D faster, R reset to 1× (again: back), G toggle 1.8×,
//       Z back 10s, X forward 10s, V show/hide the speed overlay.

(() => {
  const STEP = 0.1;
  const MIN = 0.1;
  const MAX = 16;
  const SEEK = 10;
  const PREFERRED = 1.8;
  // Sites (YouTube included) reset the rate when a new video loads. Rate
  // changes this soon after a load are undone; later ones are taken as the
  // user's choice (e.g. YouTube's own speed menu) and adopted.
  const GRACE = 2000;
  const STORE = 'speed-last';
  const KEYS = { s: 'slower', d: 'faster', r: 'reset', g: 'preferred', z: 'rewind', x: 'advance', v: 'display' };

  let settings = { ...YTQH_DEFAULTS };
  let speed = 1;
  let resetBack = PREFERRED; // R toggles back to this
  let overlaysHidden = false;
  let hasDetached = false; // speed-main.js has seen page-created audio
  let sweepTimer = 0;
  const media = new Map(); // element -> { host, box, label, loadedAt }

  const active = () => settings.enabled && settings.speed;
  const round = (v) => Math.round(Math.min(MAX, Math.max(MIN, v)) * 100) / 100;
  const same = (a, b) => Math.abs(a - b) < 0.005;
  const fmt = (v) => v.toFixed(2);

  // --- Tracking media elements ---

  function track(el) {
    if (media.has(el) || !(el instanceof HTMLMediaElement)) return;
    const st = { host: null, box: null, label: null, loadedAt: Date.now() };
    media.set(el, st);
    const loaded = () => { st.loadedAt = Date.now(); enforce(el); place(el); };
    el.addEventListener('loadstart', loaded);
    el.addEventListener('loadedmetadata', loaded);
    el.addEventListener('play', loaded);
    el.addEventListener('ratechange', () => onRateChange(el));
    enforce(el);
    place(el);
    if (!sweepTimer) sweepTimer = setInterval(sweep, 1000);
  }

  // settings.js's ad skipper runs YouTube ads at 16× and restores the rate
  // afterwards; leave the rate alone while it does.
  const adPlaying = (el) =>
    document.documentElement.hasAttribute('ytqh-ad-active') || !!el.closest('.ad-showing');

  // Put our speed on a freshly loaded element. At 1× we leave the site alone.
  function enforce(el) {
    if (adPlaying(el)) return;
    if (active() && speed !== 1 && !same(el.playbackRate, speed)) el.playbackRate = speed;
  }

  function onRateChange(el) {
    const st = media.get(el);
    updateLabel(el);
    if (!active() || adPlaying(el) || same(el.playbackRate, speed)) return;
    if (speed !== 1 && Date.now() - st.loadedAt < GRACE) {
      el.playbackRate = speed;
      return;
    }
    // Changed by the user through the site's own controls: follow it.
    setSpeed(el.playbackRate, false);
  }

  // Drop elements that left the page and add/remove overlays as sizes change.
  function sweep() {
    for (const [el, st] of media) {
      if (!el.isConnected) {
        st.host?.remove();
        media.delete(el);
      } else {
        place(el);
      }
    }
    if (!media.size) {
      clearInterval(sweepTimer);
      sweepTimer = 0;
    }
  }

  function scan() {
    document.querySelectorAll('video, audio').forEach(track);
  }

  // --- Overlay ---

  const CSS = `
    :host { all: initial; }
    .box {
      position: absolute; top: 0; left: 0; margin: 10px;
      display: flex; align-items: center; gap: 2px;
      padding: 3px 6px; border-radius: 6px;
      background: rgba(0, 0, 0, 0.65); color: #fff;
      font: 600 13px/1.2 system-ui, -apple-system, Roboto, Arial, sans-serif;
      opacity: 0.35; transition: opacity 0.15s;
      white-space: nowrap; user-select: none; cursor: default;
    }
    .box:hover, .box.flash { opacity: 1; }
    .label { min-width: 2.6em; text-align: center; }
    button {
      display: none; margin: 0; padding: 0 5px; border: 0; border-radius: 4px;
      background: transparent; color: inherit; font: inherit; cursor: pointer;
    }
    button:hover { background: rgba(255, 255, 255, 0.2); }
    .box:hover button { display: inline-block; }
  `;

  const BUTTONS = [['rewind', '«', 'Back 10s (Z)'], ['slower', '−', 'Slower (S)'],
    ['faster', '+', 'Faster (D)'], ['advance', '»', 'Forward 10s (X)'], ['display', '×', 'Hide (V)']];

  function build(el, st) {
    const host = document.createElement('ytqh-speed');
    host.style.cssText = 'all: initial; position: absolute; z-index: 2147483646; display: block; width: 0; height: 0;';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const box = document.createElement('div');
    box.className = 'box';
    const label = document.createElement('span');
    label.className = 'label';
    label.title = 'Playback speed';
    box.append(label);
    for (const [action, text, title] of BUTTONS) {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', () => run(action));
      box.insertBefore(b, action === 'faster' || action === 'advance' || action === 'display' ? null : label);
    }
    // Keep clicks on the overlay from pausing or seeking the player underneath.
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'touchstart']) {
      box.addEventListener(type, (e) => e.stopPropagation());
    }
    root.append(style, box);
    Object.assign(st, { host, box, label });
  }

  // Show the overlay on visible videos, at the video's top-left corner. Audio
  // players are too short for it (it would cover their play button), so audio
  // gets the keyboard shortcuts only.
  function place(el) {
    const st = media.get(el);
    if (!st) return;
    const want = active() && settings['speed-overlay'] && el instanceof HTMLVideoElement &&
      el.offsetWidth > 60 && el.offsetHeight > 40;
    if (!want) {
      if (st.host) st.host.style.display = 'none';
      return;
    }
    if (!st.host) build(el, st);
    st.host.style.display = overlaysHidden ? 'none' : 'block';
    // On YouTube, sit in the player itself so the overlay stays above its controls.
    const player = el.closest('.html5-video-player');
    const parent = player || el.parentNode;
    if (!parent) return;
    if (player) {
      st.host.style.top = st.host.style.left = '0';
      if (st.host.parentNode !== player) player.prepend(st.host);
    } else if (st.host.nextSibling !== el) {
      // An absolutely positioned box with no top/left sits where the media starts.
      parent.insertBefore(st.host, el);
    }
    updateLabel(el);
  }

  function updateLabel(el) {
    const st = media.get(el);
    if (st?.label) st.label.textContent = fmt(el.playbackRate);
  }

  function flash() {
    for (const st of media.values()) {
      if (!st.box) continue;
      st.box.classList.add('flash');
      clearTimeout(st.flashTimer);
      st.flashTimer = setTimeout(() => st.box.classList.remove('flash'), 1000);
    }
  }

  // --- Actions ---

  function setSpeed(value, apply = true) {
    speed = round(value);
    if (apply) {
      for (const el of media.keys()) el.playbackRate = speed;
    }
    for (const el of media.keys()) updateLabel(el);
    flash();
    tellPage();
    if (settings['speed-remember']) chrome.storage.local.set({ [STORE]: speed });
  }

  // Seek the media that's playing, or all of it when nothing is.
  function seek(delta) {
    const els = [...media.keys()].filter((el) => el.isConnected);
    const playing = els.filter((el) => !el.paused);
    for (const el of playing.length ? playing : els) {
      el.currentTime = Math.max(0, Math.min(el.duration || Infinity, el.currentTime + delta));
    }
    document.dispatchEvent(new CustomEvent('ytqh-seek', { detail: delta }));
  }

  function run(action) {
    switch (action) {
      case 'slower': return setSpeed(speed - STEP);
      case 'faster': return setSpeed(speed + STEP);
      case 'reset':
        if (speed !== 1) { resetBack = speed; return setSpeed(1); }
        return setSpeed(resetBack);
      case 'preferred': return setSpeed(speed === PREFERRED ? 1 : PREFERRED);
      case 'rewind': return seek(-SEEK);
      case 'advance': return seek(SEEK);
      case 'display':
        overlaysHidden = !overlaysHidden;
        for (const el of media.keys()) place(el);
    }
  }

  window.addEventListener('keydown', (e) => {
    if (!active() || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const action = KEYS[e.key?.toLowerCase()];
    if (!action) return;
    const target = e.composedPath()[0];
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName)) return;
    // Leave the key alone on pages without media.
    if (![...media.keys()].some((el) => el.isConnected) && !hasDetached) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    run(action);
  }, true);

  // --- Page-context helper (speed-main.js) ---

  function tellPage() {
    document.dispatchEvent(new CustomEvent('ytqh-speed', { detail: active() ? speed : null }));
  }
  document.addEventListener('ytqh-speed-hello', tellPage);
  document.addEventListener('ytqh-detached', () => { hasDetached = true; });
  // Media inside shadow DOM announces itself when it starts playing.
  document.addEventListener('ytqh-media', (e) => track(e.composedPath()[0]), true);

  // Find media as it starts loading. These events don't bubble, but they do
  // pass through the document on the way down.
  for (const type of ['loadstart', 'loadedmetadata', 'play']) {
    document.addEventListener(type, (e) => track(e.target), true);
  }
  document.addEventListener('DOMContentLoaded', scan);
  if (document.readyState !== 'loading') scan();

  // --- Popup (Video controller tab) ---

  // The popup asks every frame. Frames with media answer at once; the top
  // frame answers a moment later if none did, so the popup always hears back.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'ytqh-speed') return;
    if ('set' in msg && active()) setSpeed(msg.set);
    const hasMedia = [...media.keys()].some((el) => el.isConnected) || hasDetached;
    if (hasMedia) return reply({ speed, hasMedia });
    if (window !== top) return;
    setTimeout(() => reply({ speed, hasMedia }), 150);
    return true;
  });

  // --- Settings ---

  function applySettings() {
    for (const el of media.keys()) {
      enforce(el);
      place(el);
    }
    tellPage();
  }

  chrome.storage.sync.get(YTQH_DEFAULTS, (stored) => {
    settings = { ...YTQH_DEFAULTS, ...stored };
    if (!settings['speed-remember']) return applySettings();
    chrome.storage.local.get({ [STORE]: 1 }, (local) => {
      speed = round(local[STORE]);
      applySettings();
    });
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
      chrome.storage.sync.get(YTQH_DEFAULTS, (stored) => {
        settings = { ...YTQH_DEFAULTS, ...stored };
        applySettings();
      });
    } else if (area === 'local' && changes[STORE] && settings['speed-remember']) {
      // Speed changed in another tab: use it for the next video loaded here.
      speed = round(changes[STORE].newValue ?? 1);
    }
  });
})();
