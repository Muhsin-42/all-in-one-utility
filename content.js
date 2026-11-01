// YT Quick Hide: adds a 🚫 button to every recommendation card. One click opens
// the card's ⋮ menu and picks "Don't recommend channel", or "Not interested"
// when the channel option isn't offered (mixes, playlists, some videos).

(() => {
  // Menu labels to look for, in priority order. Add translations here if your
  // YouTube UI isn't in English.
  const PRIORITY = [
    [/don.?t recommend channel/i, /kanal nicht empfehlen/i, /ne pas recommander la cha[iî]ne/i, /no recomendar (este )?canal/i, /चैनल का सुझाव न दें/],
    [/not interested/i, /kein interesse/i, /pas int[ée]ress[ée]/i, /no me interesa/i, /दिलचस्पी नहीं/],
  ];

  // Outermost card elements on home, watch sidebar, search and shelves.
  const CARD_SEL = [
    'ytd-rich-item-renderer',
    'ytd-compact-video-renderer',
    'ytd-compact-radio-renderer',
    'ytd-compact-playlist-renderer',
    'ytd-video-renderer',
    'ytd-playlist-renderer',
    'ytd-radio-renderer',
    'yt-lockup-view-model',
  ].join(',');

  // The ⋮ button inside a card, old and new layouts.
  // YouTube uses both kebab-case (yt-foo__bar) and camelCase (ytFooBar) class names.
  const MENU_BTN_SEL = [
    '.ytLockupMetadataViewModelMenuButton button',
    '[class*="MetadataViewModelMenuButton"] button',
    '[class*="metadata-view-model__menu-button"] button',
    '.yt-lockup-metadata-view-model__menu-button button',
    '.yt-lockup-metadata-view-model-wiz__menu-button button',
    'ytd-menu-renderer yt-icon-button#button button',
    'ytd-menu-renderer yt-icon-button button',
    'ytd-menu-renderer button#button',
    'ytd-menu-renderer button',
  ];

  const ITEM_SEL = [
    'ytd-menu-service-item-renderer',
    'yt-list-item-view-model',
    'tp-yt-paper-item',
  ].join(',');

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const norm = (s) => (s || '').replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();

  const log = (...a) => console.log('[YT Quick Hide]', ...a);

  function findMenuButton(card) {
    for (const sel of MENU_BTN_SEL) {
      const b = card.querySelector(sel);
      if (b) return b;
    }
    // Fallback: any button labelled like a ⋮ menu ("More actions", "Action menu").
    const buttons = [...card.querySelectorAll('button')].filter((b) => !b.classList.contains('ytqh-btn'));
    const labelled = buttons.find((b) => /more actions|action menu|more options|menu/i.test(b.getAttribute('aria-label') || ''));
    if (labelled) return labelled;
    // Last resort: the ⋮ button is the last button outside the thumbnail link.
    const outside = buttons.filter((b) => !b.closest(
      'a#thumbnail, a[class*="ContentImage"], a[class*="content-image"], yt-thumbnail-view-model'));
    return outside[outside.length - 1] || null;
  }

  // YouTube's buttons sometimes ignore a bare .click(); send the full sequence.
  function realClick(el) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function openMenuItems() {
    // Menu items only exist in popups, so search the whole page for visible ones.
    return [...document.querySelectorAll(ITEM_SEL + ',[role="menuitem"]')].filter(
      (el) => visible(el) && !el.closest('.ytqh-host'));
  }

  function pickItem(items) {
    for (const patterns of PRIORITY) {
      const hit = items.find((el) => patterns.some((p) => p.test(norm(el.textContent))));
      if (hit) return hit;
    }
    return null;
  }

  function closeMenu() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    document.body.click();
  }

  async function hide(card) {
    const menuBtn = findMenuButton(card);
    if (!menuBtn) {
      log('No ⋮ menu button found in card', card);
      return false;
    }
    log('Opening menu via', menuBtn);
    realClick(menuBtn);

    // Wait for the popup to render, then give it a short grace period to fill
    // in before deciding the option isn't there.
    let firstSeen = 0;
    for (const start = Date.now(); Date.now() - start < 2500; ) {
      await sleep(50);
      const items = openMenuItems();
      if (!items.length) continue;
      const target = pickItem(items);
      if (target) {
        log('Clicking', norm(target.textContent));
        realClick(target.querySelector(
          'tp-yt-paper-item, [role="menuitem"], [class*="ListItemViewModelContainer"], [class*="list-item-view-model__container"], button, a') || target);
        return true;
      }
      if (!firstSeen) firstSeen = Date.now();
      else if (Date.now() - firstSeen > 500) {
        log('Menu opened but no matching option. Items:', items.map((el) => norm(el.textContent)));
        break;
      }
    }

    if (!firstSeen) log('Menu did not open');
    closeMenu();
    return false;
  }

  // --- Both at once: send both options' feedback tokens straight to YouTube. ---
  // The card's menu options are in its page data, each with a feedbackToken.
  // This needs the script to run in the page's own context ("world": "MAIN").

  function textOf(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (v.content) return v.content;
    if (v.simpleText) return v.simpleText;
    if (Array.isArray(v.runs)) return v.runs.map((r) => r.text).join('');
    return '';
  }

  function findToken(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 25) return null;
    if (typeof o.feedbackToken === 'string') return o.feedbackToken;
    for (const k in o) {
      const t = findToken(o[k], depth + 1);
      if (t) return t;
    }
    return null;
  }

  function collectOptions(o, out = [], seen = new Set(), depth = 0) {
    if (!o || typeof o !== 'object' || seen.has(o) || depth > 40) return out;
    seen.add(o);
    const item = o.listItemViewModel || o.menuServiceItemRenderer;
    if (item) {
      const text = norm(textOf(item.title) || textOf(item.text));
      const token = findToken(item);
      if (text && token) out.push({ text, token });
    }
    for (const k in o) collectOptions(o[k], out, seen, depth + 1);
    return out;
  }

  function cardData(card) {
    return card.data || card.__data?.data || card.polymerController?.data || card.inst?.data || null;
  }

  async function sha1(s) {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function authHeader() {
    const cookies = Object.fromEntries(document.cookie.split('; ').map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i), c.slice(i + 1)];
    }));
    const ts = Math.floor(Date.now() / 1000);
    const parts = [];
    for (const [name, value] of [
      ['SAPISIDHASH', cookies.SAPISID || cookies['__Secure-3PAPISID']],
      ['SAPISID1PHASH', cookies['__Secure-1PAPISID']],
      ['SAPISID3PHASH', cookies['__Secure-3PAPISID']],
    ]) {
      if (value) parts.push(`${name} ${ts}_${await sha1(`${ts} ${value} ${location.origin}`)}`);
    }
    return parts.join(' ');
  }

  async function sendFeedback(tokens) {
    const cfg = window.ytcfg;
    if (!cfg?.get) return false;
    const res = await fetch('/youtubei/v1/feedback?prettyPrint=false', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await authHeader(),
        'X-Origin': location.origin,
        'X-Goog-AuthUser': String(cfg.get('SESSION_INDEX') ?? 0),
        'X-Goog-Visitor-Id': cfg.get('VISITOR_DATA') || '',
        'X-Youtube-Client-Name': String(cfg.get('INNERTUBE_CONTEXT_CLIENT_NAME') ?? 1),
        'X-Youtube-Client-Version': cfg.get('INNERTUBE_CLIENT_VERSION') || '',
      },
      body: JSON.stringify({
        context: cfg.get('INNERTUBE_CONTEXT'),
        feedbackTokens: tokens,
        isFeedbackTokenUnencrypted: false,
        shouldMerge: false,
      }),
    });
    if (!res.ok) {
      log('Feedback request failed', res.status);
      return false;
    }
    const json = await res.json().catch(() => ({}));
    const responses = json.feedbackResponses || [];
    return responses.every((r) => r.isProcessed !== false);
  }

  async function hideBoth(card) {
    const data = cardData(card);
    if (!data) {
      log('No page data on card; using the menu instead');
      return false;
    }
    const options = collectOptions(data);
    const find = (patterns) => options.find((o) => patterns.some((p) => p.test(o.text)));
    const channel = find(PRIORITY[0]);
    const notInterested = find(PRIORITY[1]);
    if (!channel || !notInterested) {
      log('Card does not offer both options; using the menu instead. Options:', options.map((o) => o.text));
      return false;
    }
    try {
      if (!(await sendFeedback([notInterested.token, channel.token]))) return false;
    } catch (e) {
      log('Feedback request error', e);
      return false;
    }
    log('Sent Not interested + Don\'t recommend channel');
    card.style.display = 'none';
    return true;
  }

  function addButton(card) {
    if (card.dataset.ytqh) return;
    // Skip inner cards nested inside another card (e.g. lockup inside rich item).
    if (card.parentElement && card.parentElement.closest(CARD_SEL)) return;
    card.dataset.ytqh = '1';

    const btn = document.createElement('button');
    btn.className = 'ytqh-btn';
    btn.type = 'button';
    btn.title = "Not interested + Don't recommend channel";
    btn.textContent = "🚫 Don't recommend";

    // Called from the window-level click guard below.
    btn.ytqhClick = async () => {
      if (btn.classList.contains('ytqh-busy')) return;
      btn.classList.remove('ytqh-fail');
      btn.classList.add('ytqh-busy');
      // Both options in one go when the card offers both; otherwise click the best single one.
      const ok = (await hideBoth(card)) || (await hide(card));
      btn.classList.remove('ytqh-busy');
      if (!ok) {
        btn.classList.add('ytqh-fail');
        btn.title = 'Option not found in this menu';
        setTimeout(() => btn.classList.remove('ytqh-fail'), 2000);
      }
    };

    // Overlay the top of the thumbnail; fall back to the card if there isn't one.
    const host = card.querySelector('yt-thumbnail-view-model, ytd-thumbnail, a#thumbnail') || card;
    host.classList.add('ytqh-host');
    host.appendChild(btn);
  }

  function scan() {
    document.querySelectorAll(CARD_SEL).forEach(addButton);
  }

  // The band sits inside the thumbnail link, so stop clicks at the window level,
  // before the link or YouTube's own handlers can start the video.
  ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick'].forEach((type) =>
    window.addEventListener(type, (e) => {
      const btn = e.target instanceof Element && e.target.closest('.ytqh-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (type === 'click') btn.ytqhClick();
    }, true));

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  scan();
})();
