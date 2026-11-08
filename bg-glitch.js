// Glitch layer over every screen, borrowed from the half-face result video but lighter: blinking pixel
// glyphs and barcodes, scan lines, faint blue flash panels, and every few seconds a short burst of
// cyan / magenta tear lines. It sits above the screens (never takes a tap) and keeps to the sides so
// faces, titles and buttons stay clear. Runs at ~15 fps and pauses while the tab is hidden.
(() => {
  const FPS = 15;
  const GLYPHS = 8; // was 28, cut by 70% to keep the white specks sparse
  const COLORS = ['#ffffff', '#ffffff', '#9fe8ff', '#7cc4ff'];
  const SIDE = 0.24; // glyphs live in the outer 24% on each side
  const CLEAR_TOP = 0.1; // top 10% of the screen (logo area) stays free of glitch

  const cv = document.querySelector('.app-layout__fx');
  if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = cv.getContext('2d');

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  function sprite() {
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    // Size first: resizing a canvas resets its fill colour.
    if (Math.random() < 0.25) { // barcode
      c.width = Math.round(rand(10, 26)); c.height = Math.round(rand(12, 30));
      g.fillStyle = pick(COLORS);
      for (let x = 0; x < c.width; x += Math.round(rand(2, 4))) if (Math.random() < 0.7) g.fillRect(x, 0, 1, c.height);
    } else { // pixel glyph
      const cell = Math.round(rand(2, 4)), cols = Math.round(rand(3, 8)), rows = Math.round(rand(2, 6));
      c.width = cols * cell; c.height = rows * cell;
      g.fillStyle = pick(COLORS);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.random() < 0.45) g.fillRect(x * cell, y * cell, cell, cell);
    }
    return c;
  }
  const sprites = Array.from({ length: 32 }, sprite);

  let W = 0, H = 0;
  function resize() {
    W = cv.width = cv.clientWidth;
    H = cv.height = cv.clientHeight;
  }

  function spawn() {
    const left = Math.random() < 0.5;
    return {
      sprite: pick(sprites),
      x: left ? rand(0, W * SIDE) : rand(W * (1 - SIDE), W - 10),
      y: rand(0, H),
      life: Math.round(rand(4, 24)),
      alpha: rand(0.35, 0.8),
      scale: Math.random() < 0.2 ? 2 : 1,
    };
  }

  // Stacks of thin streak lines at a side edge, like the KV glitch art.
  function streaks(x, y, width, count) {
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = rand(0.15, 0.45);
      ctx.fillStyle = pick(['#cfe6ff', '#8fc2ff', '#4f8dff', '#ffffff']);
      ctx.fillRect(x + rand(-width * 0.1, width * 0.1), y + i * rand(3, 6), width * rand(0.4, 1), rand(1, 2.5));
    }
  }

  let glyphs = [];
  let scans = [], panel = null, burst = 0, streak = null, frameNo = 0;
  let nextBurst = Math.round(rand(2, 4) * FPS);

  const layout = document.querySelector('.app-layout');
  let paused = false;

  function frame() {
    // Sits out the loading screen so the art render has the device to itself.
    if (layout?.dataset.screen === 'loading') {
      if (!paused) { ctx.clearRect(0, 0, W, H); paused = true; }
      return;
    }
    paused = false;
    frameNo++;
    ctx.clearRect(0, 0, W, H);

    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      if (--g.life <= 0) { glyphs[i] = spawn(); continue; }
      if (Math.random() < 0.18) continue; // flicker
      ctx.globalAlpha = g.alpha;
      ctx.drawImage(g.sprite, g.x, g.y, g.sprite.width * g.scale, g.sprite.height * g.scale);
    }

    // Edge streaks that hang around for a few frames.
    if (!streak && Math.random() < 0.05) {
      const left = Math.random() < 0.5, w = W * rand(0.12, 0.3);
      streak = { x: left ? rand(-w * 0.2, W * 0.05) : W - w * rand(0.8, 1.1), y: rand(0, H * 0.9), w, n: Math.round(rand(5, 12)), life: Math.round(rand(3, 8)) };
    }
    if (streak) {
      streaks(streak.x, streak.y, streak.w, streak.n);
      if (--streak.life <= 0) streak = null;
    }

    // Thin scan lines.
    if (scans.length < 2 && Math.random() < 0.07) scans.push({ y: rand(0, H), h: rand(1, 3), w: rand(W * 0.2, W * 0.8), x: rand(0, W * 0.3), life: Math.round(rand(1, 3)) });
    for (const s of scans) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#c8ffff';
      ctx.fillRect(s.x, s.y, s.w, s.h);
      s.life--;
    }
    scans = scans.filter(s => s.life > 0);

    // Faint blue flash panel.
    if (!panel && Math.random() < 0.02) panel = { x: rand(-W * 0.1, W * 0.4), y: rand(0, H * 0.8), w: W * rand(0.4, 0.9), h: H * rand(0.06, 0.18), life: 2 };
    if (panel) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = '#3d7bff';
      ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
      if (--panel.life <= 0) panel = null;
    }

    // Every few seconds, a short burst of cyan / magenta tear lines across the frame.
    if (frameNo >= nextBurst) { burst = 3; nextBurst = frameNo + Math.round(rand(3, 6) * FPS); }
    if (burst > 0) {
      for (let i = 0; i < 6; i++) {
        ctx.globalAlpha = rand(0.18, 0.4);
        ctx.fillStyle = pick(['#0decff', '#68feff', '#ff3d8b', '#ffffff', '#3d7bff']);
        const y = rand(0, H);
        ctx.fillRect(rand(-W * 0.1, W * 0.5), y, W * rand(0.3, 0.9), rand(1, 5));
      }
      burst--;
    }
    ctx.globalAlpha = 1;
    // Keep a clear band across the top so the IQOS logo and Home button never sit on glitch.
    ctx.clearRect(0, 0, W, H * CLEAR_TOP);
  }

  let timer = null;
  function sync() {
    const visible = document.visibilityState === 'visible';
    if (visible && !timer) {
      resize();
      glyphs = Array.from({ length: GLYPHS }, spawn);
      timer = setInterval(frame, 1000 / FPS);
    } else if (!visible && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  document.addEventListener('visibilitychange', sync);
  addEventListener('resize', () => { if (timer) { resize(); glyphs = Array.from({ length: GLYPHS }, spawn); } });
  sync();
})();
