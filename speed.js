// Browser Kit: playback speed controller for every <video> and <audio> on any
// site, like the Video Speed Controller extension. Runs in the extension's own
// context in every frame; speed-main.js (page context) covers the media this
// script can't reach: audio that was never added to the page (new Audio()) and
// media inside shadow DOM.
//
// Keys: S slower, D faster, R reset to 1× (again: back), G toggle 1.8×,
//       Z back 10s, X forward 10s, V show/hide the speed overlay,
//       P picture-in-picture, A A–B loop (set start, set end, clear).
//
// Also boosts volume past 100% (set from the popup), like the Volume Booster
// extension, by routing each element through a Web Audio gain node.

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
  const KEYS = { s: 'slower', d: 'faster', r: 'reset', g: 'preferred', z: 'rewind', x: 'advance', v: 'display',
    p: 'pip', a: 'loop' };

  let settings = { ...YTQH_DEFAULTS };
  let speed = 1;
  let resetBack = PREFERRED; // R toggles back to this
  let overlaysHidden = false;
  let hasDetached = false; // speed-main.js has seen page-created audio
  let sweepTimer = 0;
  const media = new Map(); // element -> { host, box, label, loadedAt, loopA, loopB }

  const active = () => settings.enabled && settings.speed;
  const round = (v) => Math.round(Math.min(MAX, Math.max(MIN, v)) * 100) / 100;
  const same = (a, b) => Math.abs(a - b) < 0.005;
  const fmt = (v) => v.toFixed(2);

  // --- Tracking media elements ---

  function track(el) {
    if (media.has(el) || !(el instanceof HTMLMediaElement)) return;
    const st = { host: null, box: null, label: null, loadedAt: Date.now() };
    media.set(el, st);
    const loaded = () => { st.loadedAt = Date.now(); enforce(el); place(el); boostEl(el); };
    el.addEventListener('loadstart', loaded);
    // YouTube reuses the same element for the next video: drop its loop.
    el.addEventListener('loadstart', () => clearLoop(el));
    el.addEventListener('ended', () => {
      if (st.loopB == null) return;
      el.currentTime = st.loopA;
      el.play().catch(() => {});
    });
    el.addEventListener('loadedmetadata', loaded);
    el.addEventListener('play', loaded);
    el.addEventListener('ratechange', () => onRateChange(el));
    enforce(el);
    place(el);
    boostEl(el);
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
    ['faster', '+', 'Faster (D)'], ['advance', '»', 'Forward 10s (X)'],
    ['loop', '⟲', 'A–B loop (A)'], ['pip', '⧉', 'Picture-in-picture (P)'], ['display', '×', 'Hide (V)']];
  const BEFORE_LABEL = new Set(['rewind', 'slower']);
  // Firefox has no picture-in-picture API (it offers its own PiP toggle).
  const HAS_PIP = 'pictureInPictureEnabled' in document;

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
      if (action === 'pip' && !HAS_PIP) continue;
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', () => run(action));
      box.insertBefore(b, BEFORE_LABEL.has(action) ? label : null);
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
    if (!st?.label) return;
    const loop = st.loopB != null ? ' A–B' : st.loopA != null ? ' A' : '';
    st.label.textContent = fmt(el.playbackRate) + loop;
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

  // The element the user most likely means: a playing video, then any playing
  // media, then the biggest video on the page.
  function mainMedia() {
    const els = [...media.keys()].filter((el) => el.isConnected);
    const isVideo = (el) => el instanceof HTMLVideoElement;
    const area = (el) => el.offsetWidth * el.offsetHeight;
    return els.find((el) => isVideo(el) && !el.paused) || els.find((el) => !el.paused) ||
      els.filter(isVideo).sort((a, b) => area(b) - area(a))[0] || els[0] || null;
  }

  // --- Picture-in-picture ---

  async function togglePip() {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
      return 'exited';
    }
    const el = mainMedia();
    if (!(el instanceof HTMLVideoElement) || !document.pictureInPictureEnabled) return null;
    // Some sites opt their player out; the user asked for it, so opt back in.
    el.removeAttribute('disablePictureInPicture');
    try {
      await el.requestPictureInPicture();
      return 'entered';
    } catch {
      return 'failed';
    }
  }

  // The popup calls this through chrome.scripting.executeScript, which
  // carries over the click on its button: requestPictureInPicture() needs one.
  window.ytqhTogglePip = () => (active() ? togglePip() : null);

  // --- A–B loop ---

  let loopTimer = 0;

  function clearLoop(el) {
    const st = media.get(el);
    if (!st || st.loopA == null) return;
    st.loopA = st.loopB = null;
    updateLabel(el);
  }

  // First press marks A, second marks B and starts looping, third clears it.
  function cycleLoop() {
    const el = mainMedia();
    const st = media.get(el);
    if (!st) return;
    const t = el.currentTime;
    if (st.loopA == null) {
      st.loopA = t;
    } else if (st.loopB == null) {
      const [a, b] = t < st.loopA ? [t, st.loopA] : [st.loopA, t];
      if (b - a < 0.5) {
        clearLoop(el);
      } else {
        Object.assign(st, { loopA: a, loopB: b });
        el.currentTime = a;
        // timeupdate only fires every ~250ms, too coarse to end the loop on time.
        loopTimer ||= setInterval(loopTick, 50);
      }
    } else {
      clearLoop(el);
    }
    updateLabel(el);
    flash();
  }

  function loopTick() {
    let looping = false;
    for (const [el, st] of media) {
      if (st.loopB == null) continue;
      looping = true;
      if (el.currentTime >= st.loopB) el.currentTime = st.loopA;
    }
    if (!looping) {
      clearInterval(loopTimer);
      loopTimer = 0;
    }
  }

  function loopState() {
    const st = media.get(mainMedia());
    return st?.loopA != null ? { a: st.loopA, b: st.loopB } : null;
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
      case 'pip': return togglePip();
      case 'loop': return cycleLoop();
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

  // --- Volume boost ---

  // Gain applied to every element: 1 is normal, 6 is 600%. Kept per tab (not
  // saved) so a loud boost never carries over to the next page.
  let boost = 1;
  let audioCtx = null;
  let boostBlocked = false; // the page hasn't been clicked yet, so audio can't start
  const gains = new WeakMap(); // element -> GainNode

  const gain = () => (active() ? boost : 1);

  // Web Audio outputs silence for cross-origin media loaded without CORS, so
  // only route media we know is safe; everything else plays unboosted.
  function canRoute(el) {
    if (el.srcObject || el.crossOrigin) return true;
    const src = el.currentSrc || el.src;
    if (!src) return false;
    if (/^(blob|data):/.test(src)) return true;
    try { return new URL(src, location.href).origin === location.origin; } catch { return false; }
  }

  // Chrome only lets an AudioContext run after the user has interacted with
  // the page. Routing into a stopped context would silence the media, so wait.
  async function audioReady() {
    audioCtx ||= new AudioContext();
    if (audioCtx.state !== 'running') {
      await Promise.race([audioCtx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    }
    return audioCtx.state === 'running';
  }

  async function boostEl(el) {
    let node = gains.get(el);
    if (!node) {
      // Once routed an element can't be unrouted, so leave it alone until a
      // boost is actually wanted.
      if (gain() === 1 || !canRoute(el)) return;
      if (!(await audioReady())) {
        boostBlocked = true;
        return;
      }
      if (gains.has(el)) return;
      try {
        node = audioCtx.createGain();
        audioCtx.createMediaElementSource(el).connect(node).connect(audioCtx.destination);
      } catch {
        return; // the page already routes this element through its own Web Audio
      }
      gains.set(el, node);
    }
    node.gain.value = gain();
  }

  async function applyBoost() {
    boostBlocked = false;
    await Promise.all([...media.keys()].map(boostEl));
  }

  // Retry a blocked boost on the user's next click or key press in the page.
  for (const type of ['pointerdown', 'keydown']) {
    window.addEventListener(type, () => { if (boostBlocked) applyBoost(); }, true);
  }

  // --- Popup (Video controller tab) ---

  // The popup asks every frame. Frames with media answer; the top frame
  // answers a moment later if none did, so the popup always hears back.
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type !== 'ytqh-speed') return;
    if ('set' in msg && active()) setSpeed(msg.set);
    const hasMedia = [...media.keys()].some((el) => el.isConnected) || hasDetached;
    if (!hasMedia && window !== top) {
      if ('boost' in msg) boost = msg.boost;
      return;
    }
    (async () => {
      if (msg.loop && active()) cycleLoop();
      if ('boost' in msg && active()) {
        boost = Math.min(6, Math.max(1, msg.boost));
        await applyBoost();
      }
      if (!hasMedia) await new Promise((r) => setTimeout(r, 150));
      const routable = [...media.keys()].some((el) => el.isConnected && (gains.has(el) || canRoute(el)));
      reply({ speed, hasMedia, boost, boostBlocked, boostUnsupported: hasMedia && !routable,
        loop: loopState(), pip: !!document.pictureInPictureElement });
    })();
    return true;
  });

  // --- Settings ---

  function applySettings() {
    for (const el of media.keys()) {
      enforce(el);
      place(el);
    }
    applyBoost();
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
