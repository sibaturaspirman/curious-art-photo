// Glitch videos. Two looks:
//   'halfface' - the person toned in the KV blues on the KV background, a panel over half the face that
//                cuts between flickering footage every few frames, and pixel glyphs blinking around the head
//   'pulse'    - the same base, hit on a beat with shake, wide RGB split, torn slices and datamosh
// Rendered to a canvas and encoded frame by frame (see record()).
(() => {
  const {
    canvas, copy, tint, drawCover, personMask, locateHead, gradientLut, mapPixels, luminance, rand, pick,
    kvShard, scanlines, KV_BLUE, KV_CYAN, KV_NEG, loadTexture,
  } = window.GlitchArt.internals;

  const FPS = 30;
  const DURATION_S = 6;
  const W = 720;
  const H = Math.round(W * 1366 / 1024);
  const MIME_TYPES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

  // Visor footage tints, all from the KV's blue glitch palette.
  const TINTS = [
    { stops: ['#000514', '#06209a', '#1452ff', '#7cc4ff', '#ffffff'], glow: null },
    { stops: ['#00060f', '#004a6e', '#00d1d2', '#9ffcff', '#ffffff'], glow: 'rgba(0,209,210,.8)' },
    { stops: ['#000000', '#0a1a6b', '#3d7bff', '#c9dcff', '#ffffff'], glow: 'rgba(61,123,255,.85)' },
    { stops: ['#01030f', '#0b3fb8', '#2f8cff', '#9fe8ff', '#ffffff'], glow: 'rgba(47,140,255,.8)' },
    { stops: ['#000208', '#04123a', '#1238c9', '#5aa2ff', '#e6f4ff'], glow: null },
    { stops: ['#000514', '#1b2f6e', '#68feff', '#d6ffff', '#ffffff'], glow: 'rgba(104,254,255,.75)' },
  ];
  const PANEL_COLORS = ['#0b3fb8', '#04123a', '#1238c9', '#0a2a8a'];
  const GLYPH_COLORS = ['#ffffff', '#ffffff', '#9fe8ff', '#7cc4ff'];

  function supportedMime() {
    if (typeof MediaRecorder === 'undefined') return null;
    return MIME_TYPES.find(t => MediaRecorder.isTypeSupported(t)) || null;
  }

  // ---------- pre-rendered layers ----------
  // KV-style background: the blue radial glow and the three glitch clusters from the welcome screen.
  function kvBackground(glitch) {
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, H * 0.75);
    g.addColorStop(0, '#1f55d6');
    g.addColorStop(0.45, '#082c8c');
    g.addColorStop(1, '#020a24');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W * 0.3, H * 0.3, 0, W * 0.3, H * 0.3, W * 0.5);
    glow.addColorStop(0, 'rgba(120,160,255,.2)');
    glow.addColorStop(1, 'rgba(120,160,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    return c;
  }

  // Positions of the welcome-screen glitch clusters, in 1024 x 1366 stage units.
  const KV_CLUSTERS = [
    { x: -1173, y: -122, s: 1611 },
    { x: -398, y: -1198, s: 1611 },
    { x: 348, y: 593, s: 1611 },
  ];

  // Soft blue halo around the person.
  function personGlow(mask) {
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    ctx.filter = 'blur(30px)';
    ctx.drawImage(mask, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = 'rgba(104,200,255,.7)';
    ctx.fillRect(0, 0, W, H);
    return c;
  }

  // Body in the KV blues: navy shadows, bright blue mids, cyan-white highlights and edges.
  function blueBody(base, mask) {
    const c = canvas(W, H);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(base, 0, 0);
    const img = ctx.getImageData(0, 0, W, H);
    const d = img.data;
    const gray = new Float32Array(W * H);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = luminance(d, p);
    const lut = gradientLut(['#04123a', '#0b3fb8', '#2f8cff', '#9fe8ff', '#ffffff']);

    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const gx = gray[i + 1] - gray[i - 1] + (gray[i - W + 1] - gray[i - W - 1] + gray[i + W + 1] - gray[i + W - 1]) * 0.5;
        const gy = gray[i + W] - gray[i - W] + (gray[i + W - 1] - gray[i - W - 1] + gray[i + W + 1] - gray[i - W + 1]) * 0.5;
        const edge = Math.min(1, Math.hypot(gx, gy) / 160);
        const t = Math.min(255, Math.max(0, (gray[i] - 128) * 1.25 + 130)) | 0;
        const glowEdge = edge * edge * 180;
        const p = i * 4;
        d[p] = Math.min(255, lut[t * 3] + glowEdge * 0.6);
        d[p + 1] = Math.min(255, lut[t * 3 + 1] + glowEdge * 0.9);
        d[p + 2] = Math.min(255, lut[t * 3 + 2] + glowEdge);
      }
    }
    ctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(mask, 0, 0);
    return c;
  }

  function tinted(src, stops) {
    const c = canvas(src.width, src.height);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    const lut = gradientLut(stops);
    mapPixels(ctx, c.width, c.height, (d, p) => {
      const l = luminance(d, p) | 0;
      d[p] = lut[l * 3]; d[p + 1] = lut[l * 3 + 1]; d[p + 2] = lut[l * 3 + 2];
    });
    return c;
  }

  // Footage clips for the half-face panel, all the size of the panel.
  function visorClips(base, glitch, visor) {
    const { w: vw, h: vh } = visor;
    const raw = [];

    const half = canvas(vw, vh); // this half of the face
    half.getContext('2d').drawImage(base, visor.x, visor.y, vw, vh, 0, 0, vw, vh);
    raw.push(half);

    const zoom = canvas(vw, vh); // zoomed in around the eye
    zoom.getContext('2d').drawImage(base, visor.x, visor.y + vh * 0.25, vw * 0.6, vh * 0.35, 0, 0, vw, vh);
    raw.push(zoom);

    const other = canvas(vw, vh); // the other half of the face, mirrored across
    const octx = other.getContext('2d');
    octx.translate(vw, 0);
    octx.scale(-1, 1);
    octx.drawImage(base, visor.x - vw, visor.y, vw, vh, 0, 0, vw, vh);
    raw.push(other);

    const shard = canvas(vw, vh);
    shard.getContext('2d').drawImage(glitch, rand(glitch.width * 0.2, glitch.width * 0.5), rand(glitch.height * 0.2, glitch.height * 0.4), glitch.width * 0.3, glitch.height * 0.5, 0, 0, vw, vh);
    raw.push(shard);

    const blocks = canvas(vw, vh); // abstract data blocks
    const bctx = blocks.getContext('2d');
    for (let i = 0; i < 60; i++) {
      bctx.fillStyle = `hsl(220,90%,${rand(10, 95)}%)`;
      bctx.fillRect(rand(0, vw), rand(0, vh), rand(4, vw * 0.6), rand(2, vh * 0.08));
    }
    raw.push(blocks);

    const clips = [];
    for (const r of raw) {
      for (const tint of TINTS) {
        if (Math.random() < 0.55) clips.push({ img: tinted(r, tint.stops), glow: tint.glow && glowSprite(vw, vh, tint.glow) });
      }
    }
    for (const c of clips) addScreenLines(c.img);
    return clips;
  }

  // Glow behind the panel, blurred once here instead of with shadowBlur on every frame.
  const GLOW_PAD = 60;
  function glowSprite(vw, vh, color) {
    const c = canvas(vw + GLOW_PAD * 2, vh + GLOW_PAD * 2);
    const ctx = c.getContext('2d');
    ctx.shadowColor = color;
    ctx.shadowBlur = 40;
    ctx.fillStyle = color;
    ctx.fillRect(GLOW_PAD, GLOW_PAD, vw, vh);
    return c;
  }

  // Bright horizontal bars across a clip, like a broken screen.
  function addScreenLines(c) {
    const ctx = c.getContext('2d');
    for (let i = 0; i < 6; i++) {
      ctx.globalAlpha = rand(0.3, 0.9);
      ctx.fillStyle = pick(['#ffffff', '#d6e6ff', '#7cc4ff']);
      ctx.fillRect(rand(-20, c.width * 0.6), rand(0, c.height), rand(c.width * 0.1, c.width * 0.7), rand(1, 4));
    }
    ctx.globalAlpha = 1;
  }

  // Small white / light-blue pixel glyphs and barcodes.
  function glyphSprites() {
    const sprites = [];
    for (let i = 0; i < 40; i++) {
      const cell = Math.round(rand(2, 4));
      const cols = Math.round(rand(3, 9)), rows = Math.round(rand(2, 7));
      const c = canvas(cols * cell, rows * cell);
      const ctx = c.getContext('2d');
      ctx.fillStyle = pick(GLYPH_COLORS);
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.random() < 0.45) ctx.fillRect(x * cell, y * cell, cell, cell);
      sprites.push(c);
    }
    for (let i = 0; i < 8; i++) {
      const c = canvas(Math.round(rand(14, 30)), Math.round(rand(14, 34)));
      const ctx = c.getContext('2d');
      ctx.fillStyle = pick(GLYPH_COLORS);
      for (let x = 0; x < c.width; x += Math.round(rand(2, 4))) if (Math.random() < 0.7) ctx.fillRect(x, 0, Math.round(rand(1, 2)), c.height);
      sprites.push(c);
    }
    return sprites;
  }

  // ---------- animation ----------
  // Shards pre-composited onto one transparent layer, so a frame draws one image instead of several.
  function shardLayer(glitch, shards) {
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    ctx.globalCompositeOperation = 'screen';
    for (const s of shards) {
      ctx.globalAlpha = s.alpha;
      ctx.save();
      ctx.translate(s.x + (s.flip ? s.s : 0), s.y);
      if (s.flip) ctx.scale(-1, 1);
      ctx.drawImage(glitch, 0, 0, s.s, s.s);
      ctx.restore();
    }
    return c;
  }

  // The blue scanline texture as moving footage: it scrolls down slowly, its bands jump sideways every
  // few frames and it flickers now and then. Screen-blended; with `mask`, the person is cut out of it so
  // it only plays on the background.
  function textureFx(texture, mask = null) {
    const layer = canvas(W, H);
    const lctx = layer.getContext('2d');
    const BANDS = 6;
    let shifts = new Array(BANDS).fill(0);
    return (ctx, f, alpha = 0.6) => {
      if (!texture) return;
      if (f % 3 === 0) shifts = shifts.map(() => (Math.random() < 0.35 ? rand(-40, 40) : 0));
      const scroll = (f * 3) % H;
      lctx.globalCompositeOperation = 'source-over';
      lctx.clearRect(0, 0, W, H);
      for (let i = 0; i < BANDS; i++) {
        const y = (H / BANDS) * i;
        lctx.save();
        lctx.beginPath();
        lctx.rect(0, y, W, H / BANDS + 1);
        lctx.clip();
        lctx.drawImage(texture, shifts[i], scroll);
        lctx.drawImage(texture, shifts[i], scroll - H);
        lctx.restore();
      }
      if (mask) {
        lctx.globalCompositeOperation = 'destination-out';
        lctx.drawImage(mask, 0, 0);
      }
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = alpha * (Math.random() < 0.08 ? 0.4 : 1);
      ctx.drawImage(layer, 0, 0);
      ctx.restore();
    };
  }

  function createScene(body, clips, sprites, head, visor, glitch, background, glow, texFx) {
    const k = W / 1024;
    // Background and halo merged once.
    const stage = canvas(W, H);
    const sctx = stage.getContext('2d');
    sctx.drawImage(background, 0, 0);
    sctx.globalCompositeOperation = 'screen';
    sctx.drawImage(glow, 0, 0);
    // The welcome-screen glitch clusters, and shards around the shoulders; each layer jitters every few frames.
    const layers = [
      shardLayer(glitch, KV_CLUSTERS.map(c => ({ x: c.x * k, y: c.y * k, s: c.s * k, flip: false, alpha: 0.8 }))),
      shardLayer(glitch, [
        { x: head.cx - head.w * 1.3, y: head.eyeY + head.h * 0.3, s: head.w * 1.4, flip: false, alpha: 0.9 },
        { x: head.cx - head.w * 0.1, y: head.eyeY + head.h * 0.5, s: head.w * 1.3, flip: true, alpha: 0.9 },
      ]),
    ].map(img => ({ img, jx: 0, jy: 0 }));
    let clip = pick(clips), hold = 0;
    const particles = Array.from({ length: 46 }, () => spawn());

    function spawn() {
      // Biased towards the head and the edges of the frame.
      const nearHead = Math.random() < 0.55;
      return {
        sprite: pick(sprites),
        x: nearHead ? head.cx + rand(-head.w * 1.1, head.w * 1.1) : rand(0, W),
        y: nearHead ? head.top + rand(-head.h * 0.3, head.h * 1.6) : rand(0, H),
        life: Math.round(rand(2, 14)),
        scale: pick([1, 1, 2]),
      };
    }

    return function drawFrame(ctx, f) {
      ctx.globalAlpha = 1;
      ctx.drawImage(stage, 0, 0);

      if (Math.random() < 0.05) { // blue flash panel behind the body
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = pick(PANEL_COLORS);
        ctx.fillRect(rand(-W * 0.1, W * 0.3), rand(H * 0.05, H * 0.35), W * rand(0.5, 0.9), H * rand(0.15, 0.35));
        ctx.globalAlpha = 1;
      }

      texFx(ctx, f, 0.65); // moving scanline texture, behind the body

      // Body, with a rare horizontal tear.
      ctx.drawImage(body, 0, 0);
      if (f % 23 === 0 || Math.random() < 0.04) {
        const y = rand(0, H), sh = rand(6, 40);
        ctx.drawImage(body, 0, y, W, sh, rand(-24, 24), y, W, sh);
      }

      ctx.globalCompositeOperation = 'screen';
      for (const l of layers) {
        if (f % 4 === 0) { l.jx = rand(-8, 8); l.jy = rand(-4, 4); }
        ctx.globalAlpha = Math.random() < 0.1 ? 0.5 : 1;
        ctx.drawImage(l.img, l.jx, l.jy);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // Half-face panel: cut to a new clip every 2-4 frames; now and then it stretches outwards.
      if (hold-- <= 0) { clip = pick(clips); hold = Math.round(rand(1, 3)); }
      const stretch = Math.random() < 0.15 ? rand(1.05, 1.35) : 1;
      const vw = visor.w * stretch, vx = visor.x;
      if (clip.glow) ctx.drawImage(clip.glow, vx - GLOW_PAD, visor.y - GLOW_PAD, vw + GLOW_PAD * 2, visor.h + GLOW_PAD * 2);
      const slices = Math.round(rand(8, 16));
      for (let i = 0; i < slices; i++) {
        const sy = (visor.h / slices) * i, shH = visor.h / slices;
        const shift = Math.random() < 0.35 ? rand(-visor.w * 0.06, visor.w * 0.15) : 0;
        ctx.drawImage(clip.img, 0, sy, clip.img.width, shH, vx + shift, visor.y + sy, vw, shH);
      }
      ctx.fillStyle = 'rgba(255,255,255,.85)'; // hard edge lines: the seam down the face, and a top cap
      ctx.fillRect(vx, visor.y, 2, visor.h);
      ctx.fillRect(vx, visor.y, vw * rand(0.5, 1), 2);
      if (Math.random() < 0.5) ctx.fillRect(vx, visor.y + visor.h - 2, vw * rand(0.2, 0.6), 2);

      // Blinking glyphs.
      ctx.imageSmoothingEnabled = false;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (--p.life <= 0) { particles[i] = spawn(); continue; }
        if (Math.random() < 0.15) continue; // flicker
        ctx.drawImage(p.sprite, p.x, p.y, p.sprite.width * p.scale, p.sprite.height * p.scale);
      }
      ctx.imageSmoothingEnabled = true;

      // A few loose blocks.
      for (let i = 0; i < 5; i++) {
        if (Math.random() < 0.5) {
          ctx.fillStyle = pick(GLYPH_COLORS);
          ctx.fillRect(rand(0, W), rand(0, H), rand(4, 14), rand(4, 14));
        }
      }
    };
  }

  async function prepare(photo) {
    const base = canvas(W, H);
    drawCover(base.getContext('2d'), photo, W, H);
    const mask = await personMask(base, W, H);
    const head = await locateHead(base, mask, W, H);
    let texture = null;
    try {
      texture = canvas(W, H);
      drawCover(texture.getContext('2d'), await loadTexture(), W, H);
    } catch (err) {
      console.warn('Glitch texture unavailable', err);
      texture = null;
    }
    return { base, mask, head, texture };
  }

  // ---------- style: half-face ----------
  function halfFaceScene({ base, mask, head, texture }, glitch) {
    // Right half of the face (as seen in the image), forehead to chin.
    const visor = {
      x: Math.round(head.cx),
      y: Math.round(head.top + head.h * 0.05),
      w: Math.round(head.w * 0.55),
      h: Math.round(head.h * 0.95),
    };
    const body = blueBody(base, mask);
    const clips = visorClips(base, glitch, visor);
    return createScene(body, clips, glyphSprites(), head, visor, glitch, kvBackground(glitch), personGlow(mask), textureFx(texture));
  }

  // ---------- style: pulse ----------
  function channel(src, keep) {
    const c = copy(src);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    mapPixels(ctx, c.width, c.height, (d, p) => {
      if (keep !== 0) d[p] = 0;
      if (keep !== 1) d[p + 1] = 0;
      if (keep !== 2) d[p + 2] = 0;
    });
    return c;
  }

  // Beat-driven on the half-face look's base frame (KV background and clusters, KV-blue body, blinking
  // glyphs) without the panel. Every hit shakes the frame, splits RGB wide, tears slices and datamoshes
  // blocks; every 4th hit is harder, with a negative flash.
  // Overall strength of every glitch effect in this look (1 = the original, harder version).
  const PULSE_INTENSITY = 0.75;

  // Darker blue used by the soft version's slices and flashes, so they never wash the frame out white.
  const KV_DEEP = ['#01040f', '#061a5c', '#0f3fb8', '#2f6ee0', '#7fb2ff'];

  // `soft`: no washed-out white bands. Slices come only from the natural frame and a deep-blue tint
  // (no negative or bright cyan), the hard-hit flash is a faint deep-blue one instead of the negative,
  // and the flashes and scan bars are dimmer. `tone` scales every glitch effect on top of PULSE_INTENSITY.
  // `glyphs` thins out the blinking glyphs (the small white specks): below 1 there are fewer of them,
  // all small, and drawn faint. `bright` brings the original's white/cyan slices back into the soft
  // version, as a share of how often they show up there (0.3 = 30%). `fade` = { from, to, frames } eases
  // the glitch down over the end of the video, so the face stays clear: from `from` (share of the
  // `frames`-long timeline) it ramps to `to` times its strength over the next 15%, and stays there.
  function pulseScene({ base, mask, head, texture }, glitch, { soft = false, tone = 1, glyphs = 1, bright = 0, fade = null } = {}) {
    const texFx = textureFx(texture, mask); // the body is baked into this look's frames, so cut it out
    const I0 = PULSE_INTENSITY * tone;
    const fadeAt = f => {
      if (!fade) return 1;
      const t = Math.min(1, Math.max(0, (f / fade.frames - fade.from) / 0.15));
      return 1 - (1 - fade.to) * t * t * (3 - 2 * t); // smoothstep
    };
    const k0 = W / 1024;
    const natural = kvBackground(glitch);
    const nctx = natural.getContext('2d');
    nctx.globalCompositeOperation = 'screen';
    nctx.drawImage(personGlow(mask), 0, 0);
    nctx.drawImage(shardLayer(glitch, KV_CLUSTERS.map(c => ({ x: c.x * k0, y: c.y * k0, s: c.s * k0, flip: false, alpha: 0.8 }))), 0, 0);
    nctx.globalCompositeOperation = 'source-over';
    nctx.drawImage(blueBody(base, mask), 0, 0);

    const variants = soft
      ? [tint(natural, KV_DEEP), natural, natural]
      : [tint(natural, KV_BLUE), tint(natural, KV_CYAN), tint(natural, KV_NEG), natural, natural];
    // In the original, 2 of the 5 slice sources are the bright cyan and negative tints.
    const brightVariants = soft && bright > 0 ? [tint(natural, KV_CYAN), tint(natural, KV_NEG)] : null;
    const brightChance = 0.4 * bright;
    const sliceSource = () => (brightVariants && Math.random() < brightChance ? pick(brightVariants) : pick(variants));
    const hardFlash = soft ? variants[0] : variants[2]; // deep blue, or the negative
    const hardFlashAlpha = soft ? 0.3 : 0.75;
    const blueFlashAlpha = soft ? 0.2 : 0.45;
    const barColor = soft ? 'rgba(104,200,255,.35)' : 'rgba(160,255,255,.8)';
    const [R, G, B] = [0, 1, 2].map(k => channel(natural, k));
    const lines = canvas(W, H);
    scanlines(lines.getContext('2d'), W, H, 0.1);

    const sprites = glyphSprites();
    const spawn = () => {
      const nearHead = Math.random() < 0.55;
      return {
        sprite: pick(sprites),
        x: nearHead ? head.cx + rand(-head.w * 1.1, head.w * 1.1) : rand(0, W),
        y: nearHead ? head.top + rand(-head.h * 0.3, head.h * 1.6) : rand(0, H),
        life: Math.round(rand(2, 12)),
        scale: glyphs < 1 ? 1 : pick([1, 1, 2]),
      };
    };
    const particles = Array.from({ length: Math.round(60 * I0 * glyphs) }, spawn);
    const glyphAlpha = glyphs < 1 ? 0.5 : 1;

    const BEAT = 15; // frames between hits (0.5 s)
    let flash = [];

    return (ctx, f) => {
      const I = I0 * fadeAt(f);
      const beat = f % BEAT;
      const hard = Math.floor(f / BEAT) % 4 === 3;
      const k = Math.exp(-beat / (hard ? 6 : 4)) * (hard ? 1.5 : 1);
      if (beat === 0) {
        flash = Array.from({ length: hard ? 3 : 2 }, () => ({ x: rand(-W * 0.2, W * 0.7), y: rand(H * 0.2, H * 0.9), s: W * rand(0.4, 0.8), flip: Math.random() < 0.5 }));
      }
      const split = (3 + 26 * k) * I + rand(-1, 1);
      const zoom = 1 + 0.05 * k * I;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2 + rand(-1, 1) * 14 * k * I, H / 2 + rand(-1, 1) * 8 * k * I); // camera shake
      ctx.scale(zoom, zoom);
      ctx.translate(-W / 2, -H / 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(R, split, rand(-3, 3) * k * I);
      ctx.drawImage(G, 0, 0);
      ctx.drawImage(B, -split, rand(-3, 3) * k * I);
      ctx.globalCompositeOperation = 'source-over';

      // Torn slices across the whole frame.
      const slices = Math.round((3 + 16 * k * Math.random() + (beat === 0 ? 8 : 0)) * I);
      for (let i = 0; i < slices; i++) {
        const sy = rand(0, H), sh = rand(4, 70);
        ctx.drawImage(sliceSource(), 0, sy, W, sh, (rand(-1, 1) * W * 0.18 * k + rand(-6, 6)) * I, sy, W, sh);
      }

      // Datamosh: blocks of the frame copied out of place.
      if (beat < 5) {
        for (let i = Math.round((3 + 10 * k) * I); i > 0; i--) {
          const bw = rand(30, 160), bh = rand(20, 120), bx = rand(0, W - bw), by = rand(0, H - bh);
          ctx.drawImage(ctx.canvas, bx, by, bw, bh, bx + rand(-60, 60) * k * I, by + rand(-30, 30) * k * I, bw, bh);
        }
      }
      ctx.restore();

      texFx(ctx, f, 0.6); // moving scanline texture over the background

      if (beat < 4) for (const s of flash) kvShard(ctx, glitch, s.x, s.y, s.s, { alpha: Math.min(1, 0.9 * k) * I, flip: s.flip });
      if (hard && beat < 2) { // flash on the hard hit
        ctx.globalAlpha = hardFlashAlpha * I;
        ctx.drawImage(hardFlash, 0, 0);
        ctx.globalAlpha = 1;
      } else if (f % (BEAT * 3) < 2) { // a blue flash every third beat
        ctx.globalAlpha = Math.min(1, blueFlashAlpha * k) * I;
        ctx.drawImage(variants[0], 0, 0);
        ctx.globalAlpha = 1;
      }

      // Blinking glyphs.
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = glyphAlpha;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (--p.life <= 0) { particles[i] = spawn(); continue; }
        if (Math.random() < 0.15) continue;
        ctx.drawImage(p.sprite, p.x, p.y, p.sprite.width * p.scale, p.sprite.height * p.scale);
      }
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;

      // Cyan scan bars.
      ctx.fillStyle = barColor;
      for (let i = Math.random() < (0.3 + 0.5 * k) * I ? Math.round(1 + 2 * k * I) : 0; i > 0; i--) ctx.fillRect(0, rand(0, H), W, rand(2, 6));

      ctx.drawImage(lines, 0, 0);
    };
  }

  // Plays a scene's timeline at `speed` (e.g. 0.9 = 10% slower) by holding a frame whenever the slowed
  // timeline hasn't reached the next step yet. Every effect slows together, and the video stays 6 s.
  function atSpeed(drawFrame, speed) {
    let last = -1;
    return (ctx, f) => {
      const step = Math.floor(f * speed);
      if (step === last) return; // keep the previous frame on the canvas
      last = step;
      drawFrame(ctx, step);
    };
  }

  const PULSE_SOFT_SPEED = 0.9;

  // Calmer takes on Pulse Soft: glitch strength, speed and glyph amount, relative to Pulse Soft.
  // The app uses pulseCalmFadeSlow; the others were previews or earlier picks.
  const PULSE_CALM = {
    pulseCalm: { tone: 0.8, speed: 0.8, glyphs: 0.25 },
    pulseCalmWhite: { tone: 0.8, speed: 0.8, glyphs: 0.25, bright: 0.3 }, // with 30% white slices (preview)
    // pulseCalm with the glitch eased 40% down over the last 40% of the video (preview)
    pulseCalmFade: { tone: 0.8, speed: 0.8, glyphs: 0.25, fade: { from: 0.6, to: 0.6 } },
    // the same, eased another 20% down at the end (preview)
    pulseCalmFade2: { tone: 0.8, speed: 0.8, glyphs: 0.25, fade: { from: 0.6, to: 0.48 } },
    // Fade 2 with the glitch at half its speed (used by the app)
    pulseCalmFadeSlow: { tone: 0.8, speed: 0.4, glyphs: 0.25, fade: { from: 0.6, to: 0.48 } },
    // the same, another 10% slower (preview)
    pulseCalmFadeSlow2: { tone: 0.8, speed: 0.36, glyphs: 0.25, fade: { from: 0.6, to: 0.48 } },
    pulseCalmA: { tone: 0.8, speed: 0.8 },
    pulseCalmB: { tone: 0.65, speed: 0.7 },
    pulseCalmC: { tone: 0.5, speed: 0.6 },
    pulseCalmD: { tone: 0.4, speed: 0.48 }, // C, another 20% calmer and slower
  };

  const STYLES = {
    halfface: halfFaceScene,
    pulse: (prep, glitch) => pulseScene(prep, glitch),
    pulseSoft: (prep, glitch) => atSpeed(pulseScene(prep, glitch, { soft: true }), PULSE_SOFT_SPEED),
  };
  for (const [name, { tone, speed, glyphs, bright, fade }] of Object.entries(PULSE_CALM)) {
    const rate = PULSE_SOFT_SPEED * speed;
    // The scene sees the slowed timeline, so its length is the video's frame count times the rate.
    const fadeOpts = fade && { ...fade, frames: FPS * DURATION_S * rate };
    STYLES[name] = (prep, glitch) => atSpeed(pulseScene(prep, glitch, { soft: true, tone, glyphs, bright, fade: fadeOpts }), rate);
  }

  // Returns { blob, mimeType, poster } where poster is a JPEG data URL of the first frame.
  // onProgress(0..1) reports the share of frames encoded so far.
  async function render(photo, glitch, { style = 'halfface', onProgress } = {}) {
    return record(STYLES[style](await prepare(photo), glitch), onProgress);
  }

  // Records drawFrame(ctx, frameIndex) for DURATION_S at FPS on a W x H canvas.
  // Prefers frame-by-frame WebCodecs encoding: every frame is kept however slow the device is, so a
  // budget tablet gets the same video as a fast laptop, just a little later. Falls back to real-time
  // MediaRecorder where WebCodecs isn't available.
  async function record(drawFrame, onProgress = () => {}) {
    const out = canvas(W, H);
    const ctx = out.getContext('2d');
    drawFrame(ctx, 0);
    const poster = out.toDataURL('image/jpeg', 0.85);

    const config = await encoderConfig();
    if (config) {
      try {
        return { ...(await encodeFrames(drawFrame, ctx, out, config, onProgress)), poster };
      } catch (err) {
        console.warn('WebCodecs encoding failed, falling back to MediaRecorder', err);
      }
    }
    return { ...(await recordRealtime(drawFrame, ctx, out, onProgress)), poster };
  }

  const MUXER_URL = 'assets/vendor/mp4-muxer.min.js'; // mp4-muxer 5.1.3, served locally for offline use
  const ENCODER_CODECS = ['avc1.42001f', 'avc1.4d0028']; // H.264 Baseline 3.1, Main 4.0
  let muxerPromise = null;

  function loadMuxer() {
    if (!muxerPromise) {
      muxerPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = MUXER_URL;
        s.onload = () => resolve(window.Mp4Muxer);
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return muxerPromise;
  }

  async function encoderConfig() {
    if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
    for (const codec of ENCODER_CODECS) {
      for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
        const config = { codec, width: W, height: H, bitrate: 6_000_000, framerate: FPS, hardwareAcceleration, avc: { format: 'avc' } };
        try {
          if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
        } catch (err) { /* try the next one */ }
      }
    }
    return null;
  }

  // Yields to the event loop without timer throttling (timers slow to 1/s in a background tab).
  function yieldToPage() {
    return new Promise(resolve => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    });
  }

  async function encodeFrames(drawFrame, ctx, out, config, onProgress) {
    const { Muxer, ArrayBufferTarget } = await loadMuxer();
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: W, height: H, frameRate: FPS },
      fastStart: 'in-memory',
    });
    let failure = null;
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: err => { failure = err; },
    });
    encoder.configure(config);

    const total = FPS * DURATION_S;
    for (let f = 0; f < total; f++) {
      if (failure) throw failure;
      drawFrame(ctx, f);
      const frame = new VideoFrame(out, { timestamp: Math.round(f * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
      encoder.encode(frame, { keyFrame: f % (FPS * 2) === 0 });
      frame.close();
      onProgress((f + 1) / total);
      // Keep only a few frames queued so memory stays flat on low-RAM tablets, and let the page breathe.
      while (encoder.encodeQueueSize > 4 && !failure) await yieldToPage();
      if (f % 4 === 0) await yieldToPage();
    }
    await encoder.flush();
    encoder.close();
    if (failure) throw failure;
    muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), mimeType: 'video/mp4' };
  }

  async function recordRealtime(drawFrame, ctx, out, onProgress) {
    const mimeType = supportedMime();
    if (!mimeType) throw new Error('Video recording is not supported in this browser');

    const stream = out.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    const stopped = new Promise(r => { recorder.onstop = r; });
    recorder.start();

    const total = FPS * DURATION_S;
    const started = performance.now();
    let frame = 0;
    await new Promise(resolve => {
      const tick = () => {
        const due = Math.floor((performance.now() - started) / 1000 * FPS);
        while (frame <= due && frame < total) {
          drawFrame(ctx, frame++);
        }
        onProgress(frame / total);
        track.requestFrame?.();
        if (frame >= total) resolve();
        else setTimeout(tick, 1000 / FPS); // a timer, not rAF, so a hidden tab can't stall the recording
      };
      tick();
    });

    recorder.stop();
    await stopped;
    track.stop();
    return { blob: new Blob(chunks, { type: mimeType.split(';')[0] }), mimeType };
  }

  const supported = () => typeof VideoEncoder !== 'undefined' || !!supportedMime();

  window.GlitchVideo = { render, supported, preload: loadMuxer, styles: Object.keys(STYLES), DURATION_S };
})();
