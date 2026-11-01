// Browser Kit: WhatFont-style font inspector, injected into the current tab
// by the popup's Color tab (popup-color.js). Hovering text shows the font that
// is actually rendered plus size and weight; clicking pins a card with the full
// details (stack, line height, letter spacing, colour, element) where any value
// can be clicked to copy, or "Copy CSS" copies the lot. Esc or Exit stops it.

window.ytqhStartFontInspector = () => {
  if (window.ytqhFontStop) {
    window.ytqhFontStop();
    return;
  }

  const WEIGHTS = { 100: 'Thin', 200: 'Extra Light', 300: 'Light', 400: 'Regular', 500: 'Medium',
    600: 'Semi Bold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' };
  const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-\w+|math|emoji|fangsong|-apple-system|BlinkMacSystemFont)$/i;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .tip { position: fixed; left: 0; top: 0; pointer-events: none; display: none;
        padding: 6px 10px; border-radius: 8px; background: rgba(40,40,40,.94); color: #fff;
        box-shadow: 0 4px 14px rgba(0,0,0,.3); white-space: nowrap; }
      .tip .fam { font-size: 15px; line-height: 1.25; }
      .tip .sub { font: 12px/1.3 Roboto, Arial, sans-serif; color: #b5b5b5; }
      .outline { position: fixed; pointer-events: none; display: none;
        outline: 2px solid #3ea6ff; outline-offset: 1px; border-radius: 2px; }
      .bar { position: fixed; right: 16px; top: 16px; display: flex; align-items: center; gap: 10px;
        padding: 6px 6px 6px 12px; border-radius: 10px; background: rgba(28,28,28,.95); color: #fff;
        font: 600 12px/1.2 Roboto, Arial, sans-serif; box-shadow: 0 4px 14px rgba(0,0,0,.35); }
      .bar span { color: #aaa; font-weight: 400; }
      button { font: inherit; color: inherit; cursor: pointer; }
      .bar button { border: 0; border-radius: 7px; padding: 5px 10px; background: #3a3a3a; }
      .bar button:hover { background: #4a4a4a; }
      .card { position: absolute; width: min(316px, calc(100vw - 16px)); padding: 16px; border-radius: 14px;
        background: #282828; color: #f1f1f1; font: 13px/1.3 Roboto, Arial, sans-serif;
        box-shadow: 0 10px 34px rgba(0,0,0,.45); }
      .card::after { content: ''; position: absolute; left: var(--arrow, 30px); bottom: -7px;
        width: 14px; height: 14px; background: #282828; transform: rotate(45deg); }
      .card.below::after { bottom: auto; top: -7px; }
      .head { display: flex; align-items: flex-start; gap: 10px; }
      .name { flex: 1; min-width: 0; font-size: 22px; font-weight: 700; line-height: 1.2;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .close { flex: none; width: 30px; height: 30px; border: 0; border-radius: 8px;
        background: #3a3a3a; font-size: 18px; line-height: 1; }
      .close:hover { background: #4a4a4a; }
      .gf { display: inline-block; margin-top: 4px; color: #8ab4f8; text-decoration: none; font-size: 13px; }
      .gf:hover { text-decoration: underline; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 6px; margin-top: 12px; }
      .val { display: flex; align-items: center; gap: 7px; min-width: 0; padding: 5px 4px;
        border: 0; border-radius: 6px; background: none; text-align: left; }
      .val:hover, .stack:hover { background: #333; }
      .val svg, .stack svg { flex: none; color: #aaa; }
      .val b { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dot { flex: none; width: 15px; height: 15px; border-radius: 4px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.25); }
      .stack { display: flex; align-items: center; gap: 7px; width: 100%; margin-top: 4px; padding: 5px 4px;
        border: 0; border-radius: 6px; background: none; text-align: left; color: #aaa; }
      .stack span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .stack em { font-style: normal; font-weight: 700; color: #f1f1f1; }
      .sample { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: #333;
        font-size: 20px; line-height: 1.4; white-space: nowrap; overflow: hidden; }
      .foot { display: flex; align-items: center; justify-content: space-between; gap: 8px;
        margin-top: 12px; padding-top: 12px; border-top: 1px solid #3a3a3a; color: #aaa; font-size: 12px; }
      .copy { display: flex; align-items: center; gap: 6px; border: 0; border-radius: 8px;
        padding: 7px 12px; background: #3a3a3a; font-size: 13px; }
      .copy:hover { background: #4a4a4a; }
    </style>
    <div class="outline"></div>
    <div class="tip"><div class="fam"></div><div class="sub"></div></div>
    <div class="bar">WhatFont <span>Hover text &middot; click to pin &middot; Esc to exit</span><button type="button" class="exit">Exit</button></div>`;

  const tip = root.querySelector('.tip');
  const tipFam = root.querySelector('.tip .fam');
  const tipSub = root.querySelector('.tip .sub');
  const outline = root.querySelector('.outline');
  root.querySelector('.exit').addEventListener('click', stop);

  // --- Which font in the stack is actually rendered ---

  const ctx = document.createElement('canvas').getContext('2d');
  const SAMPLE = 'mmmmmmmmmmlli1WQ@#';
  const availCache = new Map();
  function available(name) {
    if (GENERIC.test(name)) return true;
    if (availCache.has(name)) return availCache.get(name);
    let found = false;
    for (const base of ['monospace', 'serif', 'sans-serif']) {
      ctx.font = `72px ${base}`;
      const w0 = ctx.measureText(SAMPLE).width;
      ctx.font = `72px "${name}", ${base}`;
      if (ctx.measureText(SAMPLE).width !== w0) { found = true; break; }
    }
    // A loaded web font of the same name counts even if metrics happen to match.
    if (!found) {
      for (const f of document.fonts) {
        if (f.status === 'loaded' && f.family.replace(/["']/g, '') === name) { found = true; break; }
      }
    }
    availCache.set(name, found);
    return found;
  }

  const splitStack = (css) => css.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);

  function info(el) {
    const cs = getComputedStyle(el);
    const stack = splitStack(cs.fontFamily);
    const rendered = stack.find(available) || stack[0] || 'unknown';
    const weight = Math.round(+cs.fontWeight / 100) * 100 || 400;
    return {
      el, cs, stack, rendered,
      size: cs.fontSize,
      weight: cs.fontWeight,
      weightName: WEIGHTS[weight] || cs.fontWeight,
      italic: cs.fontStyle !== 'normal',
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing === 'normal' ? '0' : cs.letterSpacing,
      color: toHex(cs.color),
    };
  }

  function toHex(css) {
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    const v = ctx.fillStyle;
    if (v.startsWith('#')) return v.toUpperCase();
    const m = v.match(/[\d.]+/g) || [0, 0, 0];
    return '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // --- Finding the text under the cursor ---

  const ours = (e) => e.composedPath().includes(host);

  function textElementAt(e) {
    const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    const node = range?.startContainer;
    if (node?.nodeType === 3 && node.textContent.trim()) {
      // Only trust the caret hit if the cursor is actually over that text.
      const r = document.createRange();
      r.selectNodeContents(node);
      for (const rect of r.getClientRects()) {
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          return node.parentElement;
        }
      }
    }
    const t = e.target;
    if (t instanceof Element && [...t.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return t;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return t;
    return null;
  }

  // --- Hover tooltip ---

  let hoverEl = null;
  function onMove(e) {
    if (ours(e)) {
      tip.style.display = outline.style.display = 'none';
      hoverEl = null;
      return;
    }
    const el = textElementAt(e);
    if (!el) {
      tip.style.display = outline.style.display = 'none';
      hoverEl = null;
      return;
    }
    if (el !== hoverEl) {
      hoverEl = el;
      const i = info(el);
      tipFam.textContent = i.rendered;
      tipFam.style.fontFamily = `"${i.rendered}", ${i.cs.fontFamily}`;
      tipSub.textContent = `${i.size} \u00b7 ${i.weightName}${i.italic ? ' Italic' : ''}`;
      const r = el.getBoundingClientRect();
      Object.assign(outline.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    }
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let left = e.clientX + 14;
    let top = e.clientY + 18;
    if (left + tw > innerWidth - 8) left = e.clientX - tw - 14;
    if (top + th > innerHeight - 8) top = e.clientY - th - 12;
    tip.style.transform = `translate(${left}px, ${top}px)`;
  }

  // --- Pinned cards ---

  const ICONS = {
    size: '<path d="M3 7V5h10v2M8 5v14M6 19h4M14 13v-1.5h7V13M17.5 11.5V19M16 19h3"/>',
    line: '<path d="M11 6h10M11 12h10M11 18h10M5 4v16M3 6l2-2 2 2M3 18l2 2 2-2"/>',
    spacing: '<path d="M3 4v16M21 4v16M8 17l4-10 4 10M9.5 13.5h5"/>',
    weight: '<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z"/>',
    tag: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',
    stack: '<path d="m12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  };
  const icon = (n) => `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;

  function copy(text) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const t = document.createElement('textarea');
    t.value = text;
    t.style.cssText = 'position:fixed;opacity:0';
    document.documentElement.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch {}
    t.remove();
  }

  function flash(card, text) {
    const hint = card.querySelector('.hint');
    hint.textContent = text;
    clearTimeout(hint.timer);
    hint.timer = setTimeout(() => { hint.textContent = 'Click a value to copy'; }, 1200);
  }

  function pin(e, el) {
    const i = info(el);
    const tag = el.tagName.toLowerCase() + (el.classList[0] ? '.' + el.classList[0] : '');
    const css = [
      `font-family: ${i.cs.fontFamily};`,
      `font-size: ${i.size};`,
      `font-weight: ${i.weight};`,
      i.italic ? `font-style: ${i.cs.fontStyle};` : '',
      `line-height: ${i.lineHeight};`,
      `letter-spacing: ${i.cs.letterSpacing};`,
      `color: ${i.color};`,
    ].filter(Boolean).join('\n');

    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="head"><div class="name"></div><button type="button" class="close" title="Close">&times;</button></div>
      <a class="gf" target="_blank" rel="noopener">Google Fonts &#8599;</a>
      <div class="grid">
        <button type="button" class="val" data-k="size" title="Font size">${icon('size')}<b></b></button>
        <button type="button" class="val" data-k="line" title="Line height">${icon('line')}<b></b></button>
        <button type="button" class="val" data-k="spacing" title="Letter spacing">${icon('spacing')}<b></b></button>
        <button type="button" class="val" data-k="weight" title="Font weight">${icon('weight')}<b></b></button>
        <button type="button" class="val" data-k="tag" title="Element">${icon('tag')}<b></b></button>
        <button type="button" class="val" data-k="color" title="Color"><span class="dot"></span><b></b></button>
      </div>
      <button type="button" class="stack" title="Font stack (the rendered font is bold)">${icon('stack')}<span></span></button>
      <div class="sample">AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz 0123456789</div>
      <div class="foot"><span class="hint">Click a value to copy</span><button type="button" class="copy">${icon('copy')}Copy CSS</button></div>`;

    card.querySelector('.name').textContent = i.rendered;
    card.querySelector('.gf').href = 'https://fonts.google.com/?query=' + encodeURIComponent(i.rendered);
    const values = {
      size: i.size, line: i.lineHeight, spacing: i.letterSpacing,
      weight: i.weight, tag, color: i.color,
    };
    for (const b of card.querySelectorAll('.val')) {
      const v = values[b.dataset.k];
      b.querySelector('b').textContent = v;
      b.title += ': ' + v;
      b.addEventListener('click', () => { copy(v); flash(card, `Copied ${v}`); });
    }
    card.querySelector('.dot').style.background = i.color;

    const stackEl = card.querySelector('.stack span');
    i.stack.forEach((name, n) => {
      if (n) stackEl.append(', ');
      if (name === i.rendered) stackEl.appendChild(document.createElement('em')).textContent = name;
      else stackEl.append(name);
    });
    card.querySelector('.stack').addEventListener('click', () => { copy(i.cs.fontFamily); flash(card, 'Copied font stack'); });

    const sample = card.querySelector('.sample');
    sample.style.fontFamily = i.cs.fontFamily;
    sample.style.fontWeight = i.weight;
    sample.style.fontStyle = i.cs.fontStyle;

    card.querySelector('.copy').addEventListener('click', () => { copy(css); flash(card, 'Copied CSS'); });
    card.querySelector('.close').addEventListener('click', () => card.remove());

    root.appendChild(card);

    // Above the clicked point with the arrow pointing at it; below if no room.
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const left = Math.max(8, Math.min(e.clientX - 30, innerWidth - w - 8));
    let top = e.clientY - h - 14;
    if (top < 8) {
      top = e.clientY + 14;
      card.classList.add('below');
    }
    card.style.setProperty('--arrow', Math.min(w - 24, Math.max(10, e.clientX - left - 7)) + 'px');
    card.style.left = left + scrollX + 'px';
    card.style.top = top + scrollY + 'px';
  }

  // --- Events ---

  function swallow(e) {
    if (ours(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (ours(e)) return;
    swallow(e);
    const el = textElementAt(e);
    if (el) pin(e, el);
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stop();
    }
  }

  function hideHover() {
    tip.style.display = outline.style.display = 'none';
    hoverEl = null;
  }

  function stop() {
    window.ytqhFontStop = null;
    host.remove();
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick']) removeEventListener(t, swallow, true);
    removeEventListener('keydown', onKey, true);
    removeEventListener('scroll', hideHover, true);
  }

  window.ytqhFontStop = stop;
  addEventListener('mousemove', onMove, true);
  addEventListener('click', onClick, true);
  for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick']) addEventListener(t, swallow, true);
  addEventListener('keydown', onKey, true);
  addEventListener('scroll', hideHover, true);
  document.documentElement.appendChild(host);
};
