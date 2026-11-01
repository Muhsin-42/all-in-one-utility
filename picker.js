// Browser Kit: eyedropper overlay, injected into the current tab by the
// popup's Color tab (popup-color.js). The popup hands over a screenshot of the
// tab; this freezes the page behind it, shows a magnifier loupe under the
// cursor, and on click copies the colour and saves it to chrome.storage.local.
// Arrow keys nudge 1px (Shift: 10px), Enter picks, Shift+click keeps picking,
// Esc cancels.

window.ytqhStartPicker = (shot) => {
  if (window.ytqhPickerActive) return;
  window.ytqhPickerActive = true;

  const GRID = 15; // pixels shown across the loupe (odd, so there's a centre)
  const CELL = 9; // screen px per magnified pixel
  const SIZE = GRID * CELL;

  const host = document.createElement('div');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `
    <style>
      .shot { position: fixed; left: 0; top: 0; width: 100vw; height: 100vh;
        background: center / 100% 100% no-repeat; cursor: none; }
      .loupe { position: fixed; left: 0; top: 0; pointer-events: none;
        display: flex; flex-direction: column; align-items: center; gap: 6px; }
      canvas { width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%;
        border: 3px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.35), 0 6px 20px rgba(0,0,0,.35);
        image-rendering: pixelated; background: #fff; }
      .label { display: flex; align-items: center; gap: 6px; padding: 4px 8px;
        border-radius: 6px; background: rgba(15,15,15,.88); color: #fff;
        font: 600 12px/1.2 ui-monospace, Menlo, Consolas, monospace; white-space: nowrap; }
      .chip { width: 12px; height: 12px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(255,255,255,.5); }
      .hint { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
        padding: 6px 12px; border-radius: 8px; background: rgba(15,15,15,.88); color: #fff;
        font: 12px/1.3 Roboto, Arial, sans-serif; pointer-events: none; white-space: nowrap; }
      .toast { position: fixed; left: 50%; top: 16px; transform: translateX(-50%);
        display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: 8px;
        background: rgba(15,15,15,.92); color: #fff; font: 600 13px/1.2 Roboto, Arial, sans-serif;
        pointer-events: none; }
    </style>
    <div class="shot"></div>
    <div class="loupe"><canvas width="${SIZE}" height="${SIZE}"></canvas>
      <div class="label"><span class="chip"></span><span class="hex"></span></div></div>
    <div class="hint">Click to copy &middot; Shift+click to pick several &middot; Arrows to nudge &middot; Esc to cancel</div>`;

  const shotEl = root.querySelector('.shot');
  const loupe = root.querySelector('.loupe');
  const canvas = root.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const chip = root.querySelector('.chip');
  const hexEl = root.querySelector('.hex');
  const hint = root.querySelector('.hint');
  shotEl.style.backgroundImage = `url("${shot}")`;

  let pixels = null; // ImageData of the whole screenshot
  let scale = 1; // screenshot px per CSS px
  let x = innerWidth / 2;
  let y = innerHeight / 2;
  let hex = '#000000';

  const img = new Image();
  img.onload = () => {
    scale = img.width / innerWidth;
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cctx = c.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(img, 0, 0);
    pixels = cctx.getImageData(0, 0, c.width, c.height);
    draw();
  };
  img.src = shot;

  const toHex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

  function draw() {
    if (!pixels) return;
    const px = Math.min(pixels.width - 1, Math.max(0, Math.floor(x * scale)));
    const py = Math.min(pixels.height - 1, Math.max(0, Math.floor(y * scale)));
    const i = (py * pixels.width + px) * 4;
    hex = toHex(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);

    const half = (GRID - 1) / 2;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, px - half, py - half, GRID, GRID, 0, 0, SIZE, SIZE);
    ctx.strokeStyle = 'rgba(0,0,0,.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < GRID; k++) {
      ctx.moveTo(k * CELL + 0.5, 0); ctx.lineTo(k * CELL + 0.5, SIZE);
      ctx.moveTo(0, k * CELL + 0.5); ctx.lineTo(SIZE, k * CELL + 0.5);
    }
    ctx.stroke();
    const c0 = half * CELL;
    ctx.strokeStyle = '#000';
    ctx.strokeRect(c0 - 0.5, c0 - 0.5, CELL + 1, CELL + 1);
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(c0 + 0.5, c0 + 0.5, CELL - 1, CELL - 1);

    chip.style.background = hex;
    hexEl.textContent = hex.toUpperCase();

    // Centre the loupe on the cursor so the middle cell is the picked pixel.
    const left = x - SIZE / 2 - 3;
    const top = y - SIZE / 2 - 3;
    loupe.style.transform = `translate(${left}px, ${top}px)`;
    // Keep the hint out from under the cursor.
    hint.style.top = y > innerHeight - 80 ? '16px' : '';
    hint.style.bottom = y > innerHeight - 80 ? 'auto' : '';
  }

  function copy(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else fallbackCopy(text);
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

  function toast(text, color) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = '<span class="chip"></span><span></span>';
    t.firstChild.style.background = color;
    t.lastChild.textContent = text;
    // Outlive the overlay so the confirmation still shows after a single pick.
    const h = document.createElement('div');
    h.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const r = h.attachShadow({ mode: 'closed' });
    r.append(root.querySelector('style').cloneNode(true), t);
    document.documentElement.appendChild(h);
    setTimeout(() => h.remove(), 1600);
  }

  function pick(keepGoing) {
    if (!pixels) return;
    const picked = hex;
    copy(picked);
    chrome.storage.local.get({ 'color-history': [] }, (s) => {
      const history = [picked, ...s['color-history'].filter((c) => c !== picked)].slice(0, 24);
      chrome.storage.local.set({ 'color-current': picked, 'color-history': history });
    });
    toast(`Copied ${picked.toUpperCase()}`, picked);
    if (!keepGoing) stop();
  }

  function stop() {
    window.ytqhPickerActive = false;
    host.remove();
    removeEventListener('keydown', onKey, true);
    removeEventListener('wheel', block, { capture: true, passive: false });
    removeEventListener('resize', stop);
  }

  function onKey(e) {
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'Escape') stop();
    else if (e.key === 'Enter') pick(e.shiftKey);
    else if (e.key === 'ArrowLeft') x -= step / scale;
    else if (e.key === 'ArrowRight') x += step / scale;
    else if (e.key === 'ArrowUp') y -= step / scale;
    else if (e.key === 'ArrowDown') y += step / scale;
    x = Math.min(innerWidth - 1, Math.max(0, x));
    y = Math.min(innerHeight - 1, Math.max(0, y));
    draw();
  }

  // The screenshot only covers what's on screen, so scrolling would desync it.
  const block = (e) => e.preventDefault();

  shotEl.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; draw(); });
  shotEl.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
  shotEl.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    x = e.clientX;
    y = e.clientY;
    draw();
    pick(e.shiftKey);
  });
  shotEl.addEventListener('contextmenu', (e) => { e.preventDefault(); stop(); });
  addEventListener('keydown', onKey, true);
  addEventListener('wheel', block, { capture: true, passive: false });
  addEventListener('resize', stop);

  document.documentElement.appendChild(host);
  draw();
};
