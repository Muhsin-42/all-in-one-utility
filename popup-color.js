// Browser Kit popup: Color tab. "Pick" screenshots the current tab and
// injects picker.js, which saves the picked colour to chrome.storage.local
// ('color-current', 'color-history'). The rest of the tab edits, converts and
// copies the current colour, and can scan the page for the colours it uses.
// "What font?" injects fontinspect.js, a WhatFont-style hover/click inspector.

const colorStatus = document.getElementById('color-status');
const swatch = document.getElementById('color-swatch');
const hexInput = document.getElementById('color-hex');
const contrastEl = document.getElementById('color-contrast');
const sv = document.getElementById('color-sv');
const svDot = document.getElementById('color-sv-dot');
const hueInput = document.getElementById('color-hue');
const formatsEl = document.getElementById('color-formats');
const shadesEl = document.getElementById('color-shades');
const historyEl = document.getElementById('color-history');
const pageEl = document.getElementById('color-page');

// The current colour as HSV, so hue survives dragging into greys and black.
let hsv = { h: 0, s: 0, v: 0 };

// --- Conversions ---

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function parseHex(str) {
  let s = str.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(s)) s = s.slice(0, 3).replace(/./g, '$&$&');
  if (/^[0-9a-f]{8}$/i.test(s)) s = s.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function rgbToHsv([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToRgb({ h, s, v }) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)].map(Math.round);
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  return [rgbToHsv([r * 255, g * 255, b * 255]).h, s, l];
}

const linear = (c) => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

function rgbToOklch(rgb) {
  const [r, g, b] = rgb.map(linear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const C = Math.hypot(A, B);
  const H = C < 0.0002 ? 0 : (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
  return [L, C, H];
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// --- Rendering ---

const FORMATS = [
  ['HEX', (rgb) => toHex(rgb).toUpperCase()],
  ['RGB', ([r, g, b]) => `rgb(${r}, ${g}, ${b})`],
  ['HSL', (rgb) => {
    const [h, s, l] = rgbToHsl(rgb);
    return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }],
  ['OKLCH', (rgb) => {
    const [l, c, h] = rgbToOklch(rgb);
    return `oklch(${(l * 100).toFixed(1)}% ${c.toFixed(3)} ${Math.round(h)})`;
  }],
  ['VAR',(rgb) => `--color: ${toHex(rgb)};`],
];

function copyText(text, el) {
  navigator.clipboard.writeText(text).then(() => {
    if (!el) return;
    const tag = el.querySelector('.copied') || el.appendChild(Object.assign(document.createElement('span'), { className: 'copied' }));
    tag.textContent = 'Copied';
    clearTimeout(el.copiedTimer);
    el.copiedTimer = setTimeout(() => tag.remove(), 1200);
  });
}

function badge(ratio) {
  const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'Fail';
  return `<b>Aa</b>${ratio.toFixed(1)} ${grade}`;
}

function chipButton(hex, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.style.background = hex;
  b.title = hex.toUpperCase();
  b.addEventListener('click', onClick || (() => setColor(parseHex(hex), true)));
  return b;
}

function renderColor() {
  const rgb = hsvToRgb(hsv);
  const hex = toHex(rgb);
  swatch.style.background = hex;
  if (document.activeElement !== hexInput) hexInput.value = hex.toUpperCase();
  hexInput.classList.remove('bad');

  sv.style.backgroundColor = `hsl(${hsv.h}, 100%, 50%)`;
  svDot.style.left = hsv.s * 100 + '%';
  svDot.style.top = (1 - hsv.v) * 100 + '%';
  svDot.style.background = hex;
  hueInput.value = Math.round(hsv.h);

  contrastEl.textContent = '';
  for (const [label, bg] of [['On white', [255, 255, 255]], ['On black', [0, 0, 0]]]) {
    const s = document.createElement('span');
    s.style.background = toHex(bg);
    s.style.color = hex;
    s.innerHTML = badge(contrast(rgb, bg));
    s.title = 'WCAG contrast of this color as text ' + label.toLowerCase();
    contrastEl.appendChild(s);
  }

  formatsEl.textContent = '';
  for (const [name, fmt] of FORMATS) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'format';
    row.title = 'Click to copy';
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = name;
    const v = document.createElement('span');
    v.className = 'value';
    v.textContent = fmt(rgb);
    row.append(n, v);
    row.addEventListener('click', () => copyText(v.textContent, row));
    formatsEl.appendChild(row);
  }

  // Tints towards white, the colour itself, then shades towards black.
  shadesEl.textContent = '';
  const steps = [0.85, 0.7, 0.5, 0.3, 0.15, 0, -0.15, -0.3, -0.5, -0.7, -0.85];
  for (const t of steps) {
    const c = toHex(t > 0 ? mix(rgb, [255, 255, 255], t) : mix(rgb, [0, 0, 0], -t));
    const b = chipButton(c);
    if (t === 0) b.className = 'here';
    shadesEl.appendChild(b);
  }
}

// save: also make it the stored current colour (and add it to history).
function setColor(rgb, save) {
  if (!rgb) return;
  const next = rgbToHsv(rgb);
  // Keep the old hue (and saturation) for greys, so the picker doesn't jump.
  if (next.s === 0) next.h = hsv.h;
  if (next.v === 0) { next.h = hsv.h; next.s = hsv.s; }
  hsv = next;
  renderColor();
  if (save) saveCurrent();
}

let saveTimer;
function saveCurrent() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const hex = toHex(hsvToRgb(hsv));
    chrome.storage.local.get({ 'color-history': [] }, (s) => {
      const history = [hex, ...s['color-history'].filter((c) => c !== hex)].slice(0, 24);
      chrome.storage.local.set({ 'color-current': hex, 'color-history': history });
    });
  }, 400);
}

function renderHistory(history) {
  historyEl.textContent = '';
  if (!history.length) {
    historyEl.innerHTML = '<p class="empty">Colors you pick show up here.</p>';
    return;
  }
  for (const hex of history) historyEl.appendChild(chipButton(hex));
}

// --- Inputs ---

hexInput.addEventListener('input', () => {
  const rgb = parseHex(hexInput.value);
  hexInput.classList.toggle('bad', !rgb);
  if (rgb) setColor(rgb, true);
});
hexInput.addEventListener('blur', renderColor);
hexInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') hexInput.blur(); });
swatch.addEventListener('click', () => copyText(toHex(hsvToRgb(hsv)).toUpperCase(), formatsEl.firstChild));
swatch.title = 'Click to copy HEX';

function dragSv(e) {
  const r = sv.getBoundingClientRect();
  hsv = { h: hsv.h, s: clamp((e.clientX - r.left) / r.width, 0, 1), v: clamp(1 - (e.clientY - r.top) / r.height, 0, 1) };
  renderColor();
}
sv.addEventListener('pointerdown', (e) => {
  sv.setPointerCapture(e.pointerId);
  dragSv(e);
});
sv.addEventListener('pointermove', (e) => { if (sv.hasPointerCapture(e.pointerId)) dragSv(e); });
sv.addEventListener('pointerup', saveCurrent);
hueInput.addEventListener('input', () => {
  hsv = { ...hsv, h: +hueInput.value };
  renderColor();
});
hueInput.addEventListener('change', saveCurrent);

document.getElementById('color-clear').addEventListener('click', () => {
  chrome.storage.local.set({ 'color-history': [] });
});

// --- Pick from page ---

document.getElementById('color-pick').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }, (shot) => {
      if (chrome.runtime.lastError || !shot) {
        colorStatus.textContent = 'Can\'t pick colors on this page (browser pages and the Web Store are off-limits).';
        return;
      }
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['picker.js'] }, () => {
        if (chrome.runtime.lastError) {
          colorStatus.textContent = 'Can\'t pick colors on this page.';
          return;
        }
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (s) => window.ytqhStartPicker(s),
          args: [shot],
        }, () => window.close());
      });
    });
  });
});

// --- What font ---

document.getElementById('font-inspect').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['fontinspect.js'] }, () => {
      if (chrome.runtime.lastError) {
        colorStatus.textContent = 'Can\'t inspect fonts on this page (browser pages and the Web Store are off-limits).';
        return;
      }
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.ytqhStartFontInspector(),
      }, () => window.close());
    });
  });
});

// --- Colors used on the page ---

// Runs in the page: tallies text, background and border colours of visible
// elements, weighting backgrounds by area, and returns the top ones as hex.
function scanPageColors() {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const toHex = (css) => {
    if (cache.has(css)) return cache.get(css);
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    const hex = a < 128 ? null : '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    cache.set(css, hex);
    return hex;
  };
  const tally = new Map();
  const add = (css, weight) => {
    if (!css || css === 'transparent' || /rgba\(.*,\s*0\)$/.test(css)) return;
    const hex = toHex(css);
    if (hex) tally.set(hex, (tally.get(hex) || 0) + weight);
  };
  const els = document.querySelectorAll('body, body *');
  for (let i = 0; i < els.length && i < 4000; i++) {
    const el = els[i];
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const area = Math.min(r.width * r.height, innerWidth * innerHeight);
    add(cs.backgroundColor, 1 + area / 2000);
    if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) add(cs.color, 4);
    if (parseFloat(cs.borderTopWidth) > 0) add(cs.borderTopColor, 1);
    if (el instanceof SVGElement) add(cs.fill, 2);
  }
  return [...tally].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([hex]) => hex);
}

document.getElementById('color-scan').addEventListener('click', () => {
  pageEl.innerHTML = '<p class="empty">Scanning…</p>';
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: scanPageColors }, (res) => {
      const colors = !chrome.runtime.lastError && res?.[0]?.result;
      pageEl.textContent = '';
      if (!colors || !colors.length) {
        pageEl.innerHTML = '<p class="empty">Can\'t read colors on this page.</p>';
        return;
      }
      for (const hex of colors) pageEl.appendChild(chipButton(hex));
    });
  });
});

// --- Startup ---

chrome.storage.local.get({ 'color-current': '#cc0000', 'color-history': [] }, (s) => {
  setColor(parseHex(s['color-current']));
  renderHistory(s['color-history']);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['color-history']) renderHistory(changes['color-history'].newValue || []);
});
