// YT Quick Hide: the page blocked sites are sent to (see blocker.js). The
// original URL is in the hash. The phrase has to be typed out: paste and drop
// are turned off.

const url = location.hash.slice(1);
const form = document.getElementById('unlock');
const input = document.getElementById('phrase');
const go = document.getElementById('go');
const note = document.getElementById('note');
let site = null;

document.getElementById('phrase-text').textContent = BLOCK_PHRASE;
for (const ev of ['paste', 'drop']) input.addEventListener(ev, (e) => e.preventDefault());
input.addEventListener('input', () => { go.disabled = !blockPhraseOk(input.value); });

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!site || !blockPhraseOk(input.value)) return;
  go.disabled = true;
  chrome.runtime.sendMessage({ type: 'ytqh-block-unlock', site, phrase: input.value }, (res) => {
    if (res?.ok) location.replace(url);
    else note.textContent = 'Couldn\'t unlock. Try again.';
  });
});

chrome.storage.sync.get(BLOCK_DEFAULTS, async (s) => {
  site = blockEntryFor(s['block-sites'], url);
  document.getElementById('site').textContent = site || url || 'This site';
  const { 'block-unlocks': unlocks = {} } = await chrome.storage.local.get('block-unlocks');
  if (!site || unlocks[site] > Date.now()) {
    // Removed from the list, or unlocked in another tab, since this page opened.
    if (/^https?:/.test(url)) location.replace(url);
    return;
  }
  form.hidden = false;
  input.focus();
});
