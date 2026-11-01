// Browser Kit: applies the popup's toggles to the page. Runs in the extension's
// own context (it needs chrome.storage), separate from content.js, which runs in
// the page's context.

(() => {
  const root = document.documentElement;
  const CACHE = 'ytqh-settings';
  let settings = { ...YTQH_DEFAULTS };
  let autoplayDoneFor = '';
  let autoplayClickedAt = 0;

  const on = (key) => settings.enabled && settings[key];

  // Set the ytqh-* flags on <html> that hide.css keys off. YouTube can drop
  // attributes on <html> while it boots and navigates, so this runs again on
  // every tick; toggleAttribute is a no-op when nothing changed.
  function setFlags() {
    for (const key of Object.keys(YTQH_DEFAULTS)) {
      if (key === 'enabled') continue;
      root.toggleAttribute('ytqh-' + key, !!on(key));
    }
    // The 🚫 button is on by default, so CSS hides it when this flag is set.
    root.toggleAttribute('ytqh-no-quick-hide', !on('quick-hide'));
    if (root.getAttribute('ytqh-page') !== pageType()) root.setAttribute('ytqh-page', pageType());
  }

  function load(stored) {
    settings = { ...YTQH_DEFAULTS, ...stored };
    // Cache in page storage so the next load can apply settings before
    // chrome.storage answers, avoiding a flash of hidden content.
    try { localStorage.setItem(CACHE, JSON.stringify(settings)); } catch {}
    tick();
    if (window === top) {
      console.log('[Browser Kit] settings applied:', Object.keys(settings).filter((k) => settings[k]).join(', '));
    }
  }

  // --- Per-page work: Shorts tagging, Subscriptions redirect, autoplay. ---

  function pageType() {
    const p = location.pathname;
    if (p === '/' || p === '/feed/') return 'home';
    if (p === '/watch') return 'watch';
    if (p === '/results') return 'search';
    if (p.startsWith('/shorts')) return 'shorts';
    if (p.startsWith('/feed/subscriptions')) return 'subscriptions';
    return 'other';
  }

  // Some Shorts only show up as a "SHORTS" badge or an is-shorts shelf, so tag
  // their cards for hide.css.
  function tagShorts() {
    document.querySelectorAll(
      'ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]:not([ytqh-seen])').forEach((badge) => {
      badge.setAttribute('ytqh-seen', '');
      badge.closest('ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-video-renderer')
        ?.setAttribute('ytqh-short', '');
    });
    document.querySelectorAll('[is-shorts]:not([ytqh-seen])').forEach((shelf) => {
      shelf.setAttribute('ytqh-seen', '');
      shelf.closest('ytd-rich-section-renderer')?.setAttribute('ytqh-short', '');
    });
  }

  function turnOffAutoplay() {
    // Desktop player toggle, then the mobile one.
    const btn = document.querySelector(
      '.ytp-autonav-toggle-button[aria-checked="true"], .ytm-autonav-toggle-button-container[aria-pressed="true"]');
    if (!btn || !btn.offsetParent) return false;
    (btn.closest('button') || btn).click();
    return true;
  }

  // --- Video ads: mute and fast-forward (approach from RYS). ---
  // Never seeks: with server-stitched ads the video's timeline includes the
  // real content, so jumping to the end would skip the video too.

  const AD_RATE = 16;
  let adHandled = false;
  let mutedBeforeAd = false;
  let rateBeforeAd = 1;

  function adShowing() {
    if (document.querySelector('#movie_player.ad-showing, .html5-video-player.ad-showing')) return true;
    return [...document.querySelectorAll('.ytp-ad-player-overlay-instream-info, .ytp-ad-button-icon')]
      .some((el) => getComputedStyle(el).display !== 'none');
  }

  // Undo our mute and speed-up once the ad is over.
  function restoreAfterAd() {
    if (!adHandled) return;
    // Clear the flag first so speed.js sees the restored rate as a normal change.
    root.removeAttribute('ytqh-ad-active');
    const video = document.querySelector('#movie_player video, video');
    if (video) {
      video.muted = mutedBeforeAd;
      if (video.playbackRate === AD_RATE) video.playbackRate = rateBeforeAd;
    }
    adHandled = false;
  }

  function skipAds() {
    document.querySelectorAll('.ytp-ad-overlay-close-button').forEach((b) => b.offsetParent && b.click());

    const video = document.querySelector('#movie_player video, video');
    if (!video || !adShowing()) {
      restoreAfterAd();
      return;
    }
    if (!adHandled) {
      mutedBeforeAd = video.muted;
      rateBeforeAd = video.playbackRate === AD_RATE ? 1 : video.playbackRate;
      adHandled = true;
    }
    video.muted = true;
    video.playbackRate = AD_RATE;

    // YouTube may ignore scripted clicks on Skip, so this is best-effort.
    document.querySelectorAll(
      '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button, .ytp-skip-ad button')
      .forEach((b) => b.offsetParent && b.click());
  }

  function adTick() {
    if (on('skip-ads')) skipAds();
    else restoreAfterAd();
    // Tells speed.js to leave the rate alone while we're fast-forwarding an ad.
    root.toggleAttribute('ytqh-ad-active', adHandled);
  }

  function tick() {
    setFlags();
    const href = location.href;

    if (on('subscriptions') && pageType() === 'subscriptions') {
      location.replace('/');
      return;
    }

    if (on('shorts')) tagShorts();

    // Switch autoplay off once per video, so the user can still turn it back on.
    if (on('autoplay') && pageType() === 'watch' && autoplayDoneFor !== href &&
        Date.now() - autoplayClickedAt > 2000) {
      const toggle = document.querySelector('.ytp-autonav-toggle-button, .ytm-autonav-toggle-button-container');
      if (toggle) {
        // After a click, wait before checking again so a slow UI update isn't
        // mistaken for "still on" and clicked back.
        if (turnOffAutoplay()) autoplayClickedAt = Date.now();
        else autoplayDoneFor = href;
      }
    }
  }

  try { settings = { ...YTQH_DEFAULTS, ...JSON.parse(localStorage.getItem(CACHE) || '{}') }; } catch {}
  tick();

  chrome.storage.sync.get(YTQH_DEFAULTS, load);
  chrome.storage.onChanged.addListener((_changes, area) => {
    if (area === 'sync') chrome.storage.sync.get(YTQH_DEFAULTS, load);
  });

  // YouTube navigates without reloading, so run on its navigation events and
  // on a timer to catch content that loads in later.
  document.addEventListener('yt-navigate-finish', tick);
  document.addEventListener('DOMContentLoaded', tick);
  window.addEventListener('popstate', tick);
  setInterval(tick, 500);
  // Ads need a faster check so they're caught within a fraction of a second.
  setInterval(adTick, 100);
})();
