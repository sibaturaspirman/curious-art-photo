// Dashed cyan outline around the visitor, like the global reference, with everything around them
// filled dark navy like the KV: traced from the person mask (MediaPipe segmentation in glitch.js) and
// drawn on a canvas laid over the camera / photo card. The photo itself is not changed.
// The dashes slowly march so it reads as "scanning". Edges where the person leaves the frame (usually
// the shoulders at the bottom) are left open instead of running along the card border.
(() => {
  const MASK_W = 160;           // mask resolution the contour is traced at
  const COLOR = '#16d9e3';
  const DASH = [13, 9];         // CSS px
  const LINE = 3;               // CSS px
  const MARCH = 18;             // CSS px per second

  // Traces the outer boundary of the person (the blob holding the topmost "on" pixel) with Moore
  // neighbour tracing. Returns [{ x, y, edge }] in 0..1, or null when nobody is there.
  function traceMask(alpha, w, h) {
    const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && alpha[(y * w + x) * 4 + 3] > 127;
    // Start at the topmost pixel near the middle of the frame, so a stray blob in a corner isn't picked.
    let sx = -1, sy = -1;
    for (let y = 0; y < h && sx < 0; y++) {
      for (let x = Math.round(w * 0.15); x < Math.round(w * 0.85); x++) if (on(x, y)) { sx = x; sy = y; break; }
    }
    if (sx < 0) return null;

    const DX = [1, 1, 0, -1, -1, -1, 0, 1]; // E, SE, S, SW, W, NW, N, NE (clockwise, y down)
    const DY = [0, 1, 1, 1, 0, -1, -1, -1];
    const pts = [];
    let x = sx, y = sy, dir = 0;
    const limit = w * h;
    for (let n = 0; n < limit; n++) {
      pts.push([x, y]);
      let moved = false;
      for (let i = 0; i < 8; i++) {
        const k = (dir + 6 + i) % 8;
        if (on(x + DX[k], y + DY[k])) { x += DX[k]; y += DY[k]; dir = k; moved = true; break; }
      }
      if (!moved || (x === sx && y === sy && pts.length > 2)) break;
    }
    if (pts.length < 30) return null;

    // Smooth (circular moving average), then thin out.
    const R = 3, out = [];
    for (let i = 0; i < pts.length; i += 2) {
      let ax = 0, ay = 0;
      for (let j = -R; j <= R; j++) { const p = pts[(i + j + pts.length) % pts.length]; ax += p[0]; ay += p[1]; }
      const [px, py] = pts[i];
      out.push({
        x: (ax / (2 * R + 1) + 0.5) / w,
        y: (ay / (2 * R + 1) + 0.5) / h,
        edge: px <= 1 || py <= 1 || px >= w - 2 || py >= h - 2,
      });
    }
    return out;
  }

  // { points, mask } for an image or canvas (mask: small canvas, person opaque), or null.
  async function trace(src) {
    const internals = window.GlitchArt?.internals;
    if (!internals) return null;
    const w = MASK_W, h = Math.round(MASK_W * src.height / src.width);
    const small = internals.canvas(w, h);
    small.getContext('2d').drawImage(src, 0, 0, w, h);
    const mask = await internals.personMask(small, w, h, { fallback: false });
    if (!mask) return null;
    const alpha = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const points = traceMask(alpha, w, h);
    return points ? { points, mask } : null;
  }

  // Dark navy like the KV, for everything around the person: a deep blue glow behind the head that
  // falls off to near-black navy at the edges.
  function paintNavy(ctx, W, H) {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.32, 0, W * 0.5, H * 0.45, Math.max(W, H) * 0.75);
    g.addColorStop(0, '#0b3a9e');
    g.addColorStop(0.45, '#06216a');
    g.addColorStop(1, '#020a2c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // A drawing surface over a card: update(result of trace) to show the navy surround and the outline,
  // clear() to hide them.
  function overlay(cv) {
    const ctx = cv.getContext('2d');
    const navy = document.createElement('canvas');
    let points = null, mask = null, navyDirty = true, raf = 0, last = 0, offset = 0;

    // Navy everywhere except the person: the KV fill with the (softened) person mask cut out of it.
    function buildNavy(W, H, dpr) {
      navy.width = W; navy.height = H;
      const n = navy.getContext('2d');
      paintNavy(n, W, H);
      n.globalCompositeOperation = 'destination-out';
      n.filter = `blur(${3 * dpr}px)`;
      n.drawImage(mask, 0, 0, W, H);
      n.filter = 'none';
      n.globalCompositeOperation = 'source-over';
      navyDirty = false;
    }

    function size() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      return dpr;
    }

    function draw(t) {
      raf = 0;
      if (!points) return;
      const dpr = size();
      offset -= ((t - (last || t)) / 1000) * MARCH;
      last = t;
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);
      if (mask) {
        if (navyDirty || navy.width !== W || navy.height !== H) buildNavy(W, H, dpr);
        ctx.drawImage(navy, 0, 0);
      }
      ctx.save();
      ctx.lineWidth = LINE * dpr;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = COLOR;
      ctx.shadowColor = 'rgba(22, 217, 227, .65)';
      ctx.shadowBlur = 8 * dpr;
      ctx.setLineDash(DASH.map(v => v * dpr));
      ctx.lineDashOffset = offset * dpr;
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= points.length; i++) {
        const p = points[i % points.length];
        if (p.edge) { pen = false; continue; }
        if (pen) ctx.lineTo(p.x * W, p.y * H); else ctx.moveTo(p.x * W, p.y * H);
        pen = true;
      }
      ctx.stroke();
      ctx.restore();
      raf = requestAnimationFrame(draw);
    }

    return {
      update(next) {
        if (!next) { this.clear(); return; }
        points = next.points;
        mask = next.mask;
        navyDirty = true;
        if (!raf) raf = requestAnimationFrame(draw);
      },
      clear() {
        points = null;
        mask = null;
        cancelAnimationFrame(raf);
        raf = 0; last = 0;
        ctx.clearRect(0, 0, cv.width, cv.height);
      },
    };
  }

  // A copy of the photo with everything around the person turned KV navy, as a JPEG data URL (or null
  // when nobody is found). Used for the loading screen; the art is still made from the original photo.
  async function navyBacked(src) {
    const res = await trace(src);
    if (!res) return null;
    const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    const person = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const p = person.getContext('2d');
    p.drawImage(src, 0, 0, W, H);
    p.globalCompositeOperation = 'destination-in';
    p.filter = `blur(${Math.max(2, W / 360)}px)`;
    p.drawImage(res.mask, 0, 0, W, H);
    const out = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const o = out.getContext('2d');
    paintNavy(o, W, H);
    o.drawImage(person, 0, 0);
    return out.toDataURL('image/jpeg', 0.9);
  }

  window.PersonOutline = { trace, overlay, navyBacked };
})();
