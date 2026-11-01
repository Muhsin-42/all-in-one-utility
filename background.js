// YT Quick Hide: turns the ad-request blocking rules (rules.json) on or off to
// match the "Block ads" switch. The rules only apply to requests made by
// YouTube pages.

importScripts('features.js');

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
