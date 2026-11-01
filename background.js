// YT Quick Hide: turns the ad-request blocking rules (rules.json) on or off to
// match the "Block ads" switch (the rules only apply to requests made by
// YouTube pages), fetches dislike counts for dislikes.js, and keeps the per-tab
// CORS rules in sync (see cors.js) and runs the site blocker (see blocker.js).

importScripts('features.js', 'cors.js', 'blocker.js');

async function syncAdRules() {
  const s = await chrome.storage.sync.get(YTQH_DEFAULTS);
  const want = s.enabled && s['block-ads'];
  await chrome.declarativeNetRequest.updateEnabledRulesets(
    want ? { enableRulesetIds: ['ads'] } : { disableRulesetIds: ['ads'] });
}

chrome.runtime.onInstalled.addListener(syncAdRules);
chrome.runtime.onStartup.addListener(syncAdRules);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && ('block-ads' in changes || 'enabled' in changes)) syncAdRules();
});

// --- Return YouTube Dislike ---
// dislikes.js asks for a video's votes here, so the request isn't subject to
// YouTube's page CORS rules.

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'ytqh-dislikes' || !/^[\w-]{11}$/.test(msg.videoId)) return;
  fetch('https://returnyoutubedislikeapi.com/votes?videoId=' + msg.videoId)
    .then((r) => (r.ok ? r.json() : null))
    .then(reply, () => reply(null));
  return true;
});

// --- CORS ---
// One session rule per tab whose page is on a listed site (rule id = tab id),
// so the exact page origin can be echoed back. Requests from other tabs, the
// browser and extensions are never touched.

const CORS_TYPES = ['xmlhttprequest', 'font', 'image', 'media'];

function corsRule(tabId, origin, s) {
  const extra = s['cors-headers'].split(',').map((h) => h.trim()).filter(Boolean);
  const creds = s['cors-credentials'];
  // "*" is a wildcard only without credentials; with them it must be a list.
  const allow = creds ? [...CORS_ALLOW_HEADERS, ...extra].join(', ') : '*';
  const expose = creds ? [...CORS_EXPOSE_HEADERS, ...extra].join(', ') : '*';
  const headers = [
    { header: 'Access-Control-Allow-Origin', operation: 'set', value: origin },
    { header: 'Access-Control-Allow-Methods', operation: 'set', value: CORS_METHODS },
    { header: 'Access-Control-Allow-Headers', operation: 'set', value: allow },
    { header: 'Access-Control-Expose-Headers', operation: 'set', value: expose },
  ];
  if (creds) headers.push({ header: 'Access-Control-Allow-Credentials', operation: 'set', value: 'true' });
  if (s['cors-private-network']) {
    headers.push({ header: 'Access-Control-Allow-Private-Network', operation: 'set', value: 'true' });
  }
  return {
    id: tabId,
    priority: 1,
    action: { type: 'modifyHeaders', responseHeaders: headers },
    condition: { tabIds: [tabId], resourceTypes: CORS_TYPES },
  };
}

async function corsSettings() {
  const s = await chrome.storage.sync.get({ enabled: true, ...CORS_DEFAULTS });
  return s.enabled ? s : { ...s, 'cors-sites': [] };
}

// Updates are queued so overlapping tab events can't race each other.
let corsQueue = Promise.resolve();
function corsQueued(fn) {
  corsQueue = corsQueue.then(fn).catch((e) => console.warn('YTQH CORS:', e));
  return corsQueue;
}

function corsBadge(tabId, on) {
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#2ba640' }).catch(() => {});
  chrome.action.setBadgeText({ tabId, text: on ? 'CORS' : '' }).catch(() => {});
}

// Rebuilds every tab's rule (settings changed, or the browser started).
function syncCorsAll() {
  return corsQueued(async () => {
    const s = await corsSettings();
    const tabs = await chrome.tabs.query({});
    const old = await chrome.declarativeNetRequest.getSessionRules();
    const addRules = [];
    for (const tab of tabs) {
      const origin = corsOriginFor(s['cors-sites'], tab.url || '');
      if (origin) addRules.push(corsRule(tab.id, origin, s));
      corsBadge(tab.id, !!origin);
    }
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: old.map((r) => r.id), addRules });
  });
}

function syncCorsTab(tabId, url) {
  return corsQueued(async () => {
    const s = await corsSettings();
    const origin = url ? corsOriginFor(s['cors-sites'], url) : null;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [tabId], addRules: origin ? [corsRule(tabId, origin, s)] : [] });
    if (url) corsBadge(tabId, !!origin);
  });
}

chrome.runtime.onInstalled.addListener(syncCorsAll);
chrome.runtime.onStartup.addListener(syncCorsAll);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && ('enabled' in changes || Object.keys(changes).some((k) => k.startsWith('cors-')))) {
    syncCorsAll();
  }
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // Chrome clears tab badges on navigation, so redo it once the page loads.
  if (info.url || info.status === 'complete') syncCorsTab(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => syncCorsTab(tabId, null));
chrome.tabs.onReplaced.addListener((added, removed) => {
  syncCorsTab(removed, null);
  chrome.tabs.get(added).then((tab) => syncCorsTab(added, tab.url), () => {});
});

// --- Site blocker ---
// One dynamic rule redirects every locked site (see blocker.js) to
// blocked.html. Unlocks live in storage.local as { site: expiry }; an alarm
// fires at the next expiry to lock the site again and pull its open tabs back
// to the blocked page.

const BLOCK_RULE_ID = 1;
const BLOCK_ALARM = 'block-relock';
const blockedPage = (url) => chrome.runtime.getURL('blocked.html') + '#' + url;

async function blockState() {
  const { 'block-sites': sites } = await chrome.storage.sync.get(BLOCK_DEFAULTS);
  const { 'block-unlocks': unlocks = {} } = await chrome.storage.local.get('block-unlocks');
  const now = Date.now();
  const live = Object.fromEntries(
    Object.entries(unlocks).filter(([s, until]) => until > now && sites.includes(s)));
  return { sites, unlocks: live, stale: Object.keys(live).length !== Object.keys(unlocks).length };
}

let blockQueue = Promise.resolve();
function syncBlock() {
  blockQueue = blockQueue.then(async () => {
    const { sites, unlocks, stale } = await blockState();
    if (stale) await chrome.storage.local.set({ 'block-unlocks': unlocks });
    const locked = sites.filter((s) => !(s in unlocks));
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [BLOCK_RULE_ID],
      addRules: locked.length ? [{
        id: BLOCK_RULE_ID,
        priority: 100,
        action: { type: 'redirect', redirect: { regexSubstitution: blockedPage('\\0') } },
        condition: { regexFilter: '^.+$', requestDomains: locked, resourceTypes: ['main_frame'] },
      }] : [],
    });
    const next = Math.min(...Object.values(unlocks));
    await chrome.alarms.clear(BLOCK_ALARM);
    if (isFinite(next)) chrome.alarms.create(BLOCK_ALARM, { when: next });
    for (const tab of await chrome.tabs.query({})) {
      if (tab.url && locked.includes(blockEntryFor(sites, tab.url))) {
        chrome.tabs.update(tab.id, { url: blockedPage(tab.url) }).catch(() => {});
      }
    }
  }).catch((e) => console.warn('YTQH blocker:', e));
  return blockQueue;
}

chrome.runtime.onInstalled.addListener(syncBlock);
chrome.runtime.onStartup.addListener(syncBlock);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === BLOCK_ALARM) syncBlock(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'sync' && 'block-sites' in changes) || (area === 'local' && 'block-unlocks' in changes)) {
    syncBlock();
  }
});

// Catches navigations the rule can't see (pages served from a service worker
// cache, in-page history changes).
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const { sites, unlocks } = await blockState();
  const site = blockEntryFor(sites, info.url);
  if (site && !(site in unlocks)) chrome.tabs.update(tabId, { url: blockedPage(info.url) }).catch(() => {});
});

// blocked.js sends the typed phrase here; the reply comes once the rule is
// updated, so the page can go straight back to the site.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type !== 'ytqh-block-unlock') return;
  (async () => {
    const { sites, unlocks } = await blockState();
    if (!sites.includes(msg.site) || !blockPhraseOk(msg.phrase)) return reply({ ok: false });
    unlocks[msg.site] = Date.now() + BLOCK_UNLOCK_MS;
    await chrome.storage.local.set({ 'block-unlocks': unlocks });
    await syncBlock();
    reply({ ok: true, until: unlocks[msg.site] });
  })();
  return true;
});
