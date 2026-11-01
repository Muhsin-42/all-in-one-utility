// YT Quick Hide popup: one switch per feature in features.js, saved to
// chrome.storage.sync (settings.js applies them to open YouTube tabs).

const form = document.getElementById('toggles');
// "Hide all" / "Show all" leave the general, ad and speed switches alone.
const HIDE_KEYS = Object.keys(YTQH_DEFAULTS).filter(
  (k) => k !== 'enabled' && k !== 'quick-hide' && !k.endsWith('-ads') && !k.startsWith('speed'));

function render(settings) {
  form.textContent = '';
  for (const f of YTQH_FEATURES) {
    if (f.group) {
      const h = document.createElement('h2');
      h.textContent = f.group;
      form.appendChild(h);
      continue;
    }
    if (f.note) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = f.note;
      form.appendChild(p);
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
    form.appendChild(row);
  }
  document.body.classList.toggle('off', !settings.enabled);
}

function setAll(value) {
  chrome.storage.sync.set(Object.fromEntries(HIDE_KEYS.map((k) => [k, value])));
}

document.getElementById('all-on').addEventListener('click', () => setAll(true));
document.getElementById('all-off').addEventListener('click', () => setAll(false));

chrome.storage.sync.get(YTQH_DEFAULTS, render);
chrome.storage.onChanged.addListener(() => chrome.storage.sync.get(YTQH_DEFAULTS, render));
