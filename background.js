// YT Quick Hide: turns the ad-request blocking rules (rules.json) on or off to
// match the "Block ads" switch (the rules only apply to requests made by
// YouTube pages), fetches dislike counts for dislikes.js, and keeps the per-tab
// CORS rules in sync (see cors.js).

importScripts('features.js', 'cors.js');

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
