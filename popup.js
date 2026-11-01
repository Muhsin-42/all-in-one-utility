// Browser Kit popup: one switch per feature in features.js, saved to
// chrome.storage.sync (settings.js applies them to open YouTube tabs).

const form = document.getElementById('toggles');
const speedForm = document.getElementById('speed-settings');
// "Hide all" / "Show all" leave the general, ad, dislike and speed switches alone.
const HIDE_KEYS = Object.keys(YTQH_DEFAULTS).filter(
  (k) => !['enabled', 'quick-hide', 'dislikes'].includes(k) && !k.endsWith('-ads') && !k.startsWith('speed'));

function render(settings) {
  form.textContent = '';
  speedForm.textContent = '';
  // Groups marked tab: 'speed' go in the Video controller tab's settings.
  let target = form;
  for (const f of YTQH_FEATURES) {
    if (f.group) {
      target = f.tab === 'speed' ? speedForm : form;
      const h = document.createElement('h2');
      h.textContent = f.group;
      target.appendChild(h);
      continue;
    }
    if (f.note) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = f.note;
      target.appendChild(p);
      continue;
    }
    const row = document.createElement('label');
    row.className = 'row';
    const text = document.createElement('span');
    text.textContent = f.label;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!settings[f.key];
    input.addEventListener('change', () => chrome.storage.sync.set({ [f.key]: input.checked }));
    row.append(text, input);
    target.appendChild(row);
  }
  document.body.classList.toggle('off', !settings.enabled);
  renderSpeed(settings);
}

function setAll(value) {
  chrome.storage.sync.set(Object.fromEntries(HIDE_KEYS.map((k) => [k, value])));
}

document.getElementById('all-on').addEventListener('click', () => setAll(true));
document.getElementById('all-off').addEventListener('click', () => setAll(false));

// --- Tabs ---

const TAB_KEY = 'ytqh-popup-tab';

function showTab(name) {
  for (const b of document.querySelectorAll('.tabs button')) {
    b.setAttribute('aria-selected', b.dataset.tab === name);
  }
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== 'tab-' + name;
  try { localStorage.setItem(TAB_KEY, name); } catch {}
}

for (const b of document.querySelectorAll('.tabs button')) {
  b.addEventListener('click', () => showTab(b.dataset.tab));
}
let savedTab = 'yt';
try { savedTab = localStorage.getItem(TAB_KEY) || 'yt'; } catch {}
showTab(savedTab);

// --- Video controller tab: talks to speed.js in the current tab ---

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5];
const presets = document.getElementById('speed-presets');
const current = document.getElementById('speed-current');
const status = document.getElementById('speed-status');
let speedOn = true;
let speed = 1;

for (const p of PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'speed-btn';
  b.textContent = p;
  b.dataset.speed = p;
  b.addEventListener('click', () => sendSpeed(p));
  presets.appendChild(b);
}

const round = (v) => Math.round(Math.min(16, Math.max(0.1, v)) * 100) / 100;

function showSpeed(value) {
  speed = value;
  current.textContent = String(value);
  for (const b of presets.children) b.classList.toggle('active', +b.dataset.speed === value);
}

let speedSetting = true;

function renderSpeed(settings) {
  speedSetting = !!settings.speed;
  speedOn = !!(settings.enabled && settings.speed);
  if (!settings.enabled) status.textContent = 'The extension is off (see the YT tab).';
  document.getElementById('speed-power').classList.toggle('on', speedOn);
  document.getElementById('tab-speed').classList.toggle('speed-off', !speedOn);
}

// Ask the page for its speed (frames with media answer), or set a new one.
// Pages the extension can't run on (chrome://, the Web Store) don't answer.
function askTab(msg) {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'ytqh-speed', ...msg }, (res) => {
      if (chrome.runtime.lastError || !res) {
        status.textContent = 'Speed control isn\'t available on this page.';
        chrome.storage.local.get({ 'speed-last': 1 }, (s) => { if (!('set' in msg)) showSpeed(s['speed-last']); });
        if ('set' in msg) chrome.storage.local.set({ 'speed-last': msg.set });
        return;
      }
      showSpeed(res.speed);
      showBoost(res.boost ?? 1);
      showLoop(res.loop);
      document.getElementById('pip-btn').classList.toggle('active', !!res.pip);
      status.textContent = !res.hasMedia ? 'No video or audio on this page yet.'
        : res.boostBlocked ? 'Click anywhere on the page once to start the volume boost.'
        : res.boostUnsupported && res.boost > 1 ? 'This page\'s audio can\'t be boosted (it comes from another site).'
        : '';
    });
  });
}

function sendSpeed(value) {
  if (!speedOn) return;
  showSpeed(round(value));
  askTab({ set: speed });
}

for (const b of document.querySelectorAll('[data-step]')) {
  b.addEventListener('click', () => sendSpeed(speed + +b.dataset.step));
}
current.addEventListener('click', () => sendSpeed(1));
document.getElementById('speed-power').addEventListener('click', () => {
  chrome.storage.sync.set({ speed: !speedSetting });
});
document.getElementById('speed-gear').addEventListener('click', (e) => {
  speedForm.hidden = !speedForm.hidden;
  e.currentTarget.classList.toggle('on', !speedForm.hidden);
});

// --- Picture-in-picture and A–B loop ---

const loopBtn = document.getElementById('loop-btn');
const loopLabel = document.getElementById('loop-label');
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

function showLoop(loop) {
  loopLabel.textContent = !loop ? 'Set A'
    : loop.b == null ? `${clock(loop.a)} → set B` : `${clock(loop.a)} → ${clock(loop.b)}`;
  loopBtn.classList.toggle('active', loop?.b != null);
}

// Runs speed.js's toggle through executeScript rather than a message, because
// only executeScript passes this click on to the page, and the browser won't
// open picture-in-picture without one.
document.getElementById('pip-btn').addEventListener('click', () => {
  if (!speedOn) return;
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => window.ytqhTogglePip?.() ?? null,
    }, (res) => {
      const results = chrome.runtime.lastError ? [] : (res || []).map((r) => r.result);
      if (results.includes('entered')) window.close();
      else if (results.includes('exited')) document.getElementById('pip-btn').classList.remove('active');
      else status.textContent = results.includes('failed')
        ? 'This video can\'t be popped out.' : 'No video to pop out on this page.';
    });
  });
});

loopBtn.addEventListener('click', () => {
  if (speedOn) askTab({ loop: true });
});

// --- Volume boost ---

const boostInput = document.getElementById('boost');
const boostValue = document.getElementById('boost-value');

function showBoost(gain) {
  const pct = Math.round(gain * 100);
  boostInput.value = pct;
  boostValue.textContent = pct + '%';
  boostValue.classList.toggle('loud', pct > 100);
}

boostInput.addEventListener('input', () => {
  boostValue.textContent = boostInput.value + '%';
  boostValue.classList.toggle('loud', +boostInput.value > 100);
  if (speedOn) askTab({ boost: boostInput.value / 100 });
});
boostValue.addEventListener('click', () => {
  showBoost(1);
  if (speedOn) askTab({ boost: 1 });
});

askTab({});

// --- CORS tab: edits the site list in cors.js's settings (background.js applies it) ---

const corsThis = document.getElementById('cors-this');
const corsStatus = document.getElementById('cors-status');
const corsList = document.getElementById('cors-list');
const corsHeaders = document.getElementById('cors-headers');
let cors = { ...CORS_DEFAULTS };
let tabUrl = '';
let tabOrigin = '';

function setSites(sites) {
  chrome.storage.sync.set({ 'cors-sites': [...new Set(sites)] });
}

function renderCors(settings) {
  cors = settings;
  const sites = cors['cors-sites'];
  const on = !!corsOriginFor(sites, tabUrl);
  document.getElementById('cors-origin').textContent = tabOrigin || 'This page';
  corsThis.checked = on;
  corsThis.disabled = !tabOrigin;
  corsStatus.textContent = !tabOrigin ? 'CORS can only be allowed on http and https pages.'
    : !settings.enabled ? 'The extension is off (see the YT tab).'
    : on ? 'Active in this tab. Reload if requests already failed.'
    : '';

  corsList.textContent = '';
  if (!sites.length) {
    const li = document.createElement('li');
    li.className = 'note';
    li.textContent = 'No sites yet.';
    corsList.appendChild(li);
  }
  for (const site of sites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = 'Remove';
    remove.textContent = '×';
    remove.addEventListener('click', () => setSites(sites.filter((s) => s !== site)));
    li.append(name, remove);
    corsList.appendChild(li);
  }

  document.getElementById('cors-credentials').checked = cors['cors-credentials'];
  document.getElementById('cors-private-network').checked = cors['cors-private-network'];
  if (document.activeElement !== corsHeaders) corsHeaders.value = cors['cors-headers'];
  document.getElementById('tab-cors').classList.toggle('speed-off', !settings.enabled);
}

corsThis.addEventListener('change', () => {
  const sites = cors['cors-sites'];
  // Turning it off removes every entry that covers this page, not just its origin.
  setSites(corsThis.checked ? [...sites, tabOrigin]
    : sites.filter((s) => !corsOriginFor([s], tabUrl)));
});

document.getElementById('cors-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('cors-add-input');
  const site = corsNormalize(input.value);
  if (!site) {
    input.setCustomValidity('Enter a host like localhost:3000 or an origin like https://app.example.com');
    input.reportValidity();
    return;
  }
  input.value = '';
  setSites([...cors['cors-sites'], site]);
});
document.getElementById('cors-add-input').addEventListener('input', (e) => e.target.setCustomValidity(''));

for (const key of ['cors-credentials', 'cors-private-network']) {
  document.getElementById(key).addEventListener('change', (e) => {
    chrome.storage.sync.set({ [key]: e.target.checked });
  });
}
corsHeaders.addEventListener('change', () => {
  chrome.storage.sync.set({ 'cors-headers': corsHeaders.value.trim() });
});

const CORS_KEYS = { enabled: true, ...CORS_DEFAULTS };
chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  tabUrl = tab?.url || '';
  try {
    const u = new URL(tabUrl);
    if (u.protocol === 'http:' || u.protocol === 'https:') tabOrigin = u.origin;
  } catch {}
  chrome.storage.sync.get(CORS_KEYS, renderCors);
});
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') chrome.storage.sync.get(CORS_KEYS, renderCors);
});

// --- Focus tab: edits the blocked-site list in blocker.js's settings (background.js applies it) ---

const blockThis = document.getElementById('block-this');
const blockStatus = document.getElementById('block-status');
const blockList = document.getElementById('block-list');
let blockSites = [];
let blockUnlocks = {};
let blockSite = '';

function setBlockSites(sites) {
  chrome.storage.sync.set({ 'block-sites': [...new Set(sites)] });
}

function lockSite(site) {
  const { [site]: _, ...rest } = blockUnlocks;
  chrome.storage.local.set({ 'block-unlocks': rest });
}

const left = (ms) => {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
};

function renderBlock() {
  const now = Date.now();
  const open = (site) => blockUnlocks[site] > now;
  const entry = blockEntryFor(blockSites, tabUrl);
  document.getElementById('block-origin').textContent = blockSite || 'This page';
  blockThis.disabled = !blockSite || !!entry;
  blockThis.textContent = entry ? 'This site is blocked' : 'Block this site';
  blockStatus.textContent = !blockSite ? 'Only http and https sites can be blocked.'
    : entry && open(entry) ? 'Unlocked for ' + left(blockUnlocks[entry] - now) + ' more.'
    : '';

  blockList.textContent = '';
  if (!blockSites.length) {
    const li = document.createElement('li');
    li.className = 'note';
    li.textContent = 'No sites yet.';
    blockList.appendChild(li);
  }
  for (const site of blockSites) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    const state = document.createElement('span');
    state.className = 'block-state';
    li.append(name, state);
    if (open(site)) {
      state.textContent = left(blockUnlocks[site] - now);
      const lock = document.createElement('button');
      lock.type = 'button';
      lock.title = 'Lock now';
      lock.textContent = '🔒';
      lock.addEventListener('click', () => lockSite(site));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Remove';
      remove.textContent = '×';
      remove.addEventListener('click', () => setBlockSites(blockSites.filter((s) => s !== site)));
      state.after(lock, remove);
    } else {
      state.textContent = 'locked';
      state.title = 'Open the site and type the phrase to unlock it before removing';
    }
    blockList.appendChild(li);
  }
}

blockThis.addEventListener('click', () => {
  if (blockSite) setBlockSites([...blockSites, blockSite]);
});

document.getElementById('block-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('block-add-input');
  const site = blockNormalize(input.value);
  if (!site) {
    input.setCustomValidity('Enter a site like instagram.com');
    input.reportValidity();
    return;
  }
  input.value = '';
  setBlockSites([...blockSites, site]);
});
document.getElementById('block-add-input').addEventListener('input', (e) => e.target.setCustomValidity(''));

function loadBlock() {
  chrome.storage.sync.get(BLOCK_DEFAULTS, (s) => {
    chrome.storage.local.get({ 'block-unlocks': {} }, (l) => {
      blockSites = s['block-sites'];
      blockUnlocks = l['block-unlocks'];
      renderBlock();
    });
  });
}

chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  tabUrl = tab?.url || '';
  blockSite = blockNormalize(/^https?:/.test(tabUrl) ? tabUrl : '');
  loadBlock();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'sync' && 'block-sites' in changes) || (area === 'local' && 'block-unlocks' in changes)) loadBlock();
});
// Keep the countdowns ticking while the popup is open.
setInterval(() => { if (Object.keys(blockUnlocks).length) renderBlock(); }, 1000);

chrome.storage.sync.get(YTQH_DEFAULTS, render);
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') chrome.storage.sync.get(YTQH_DEFAULTS, render);
});
