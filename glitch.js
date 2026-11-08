// Glitch photo filter. Three looks:
//   'overlay' - black & white photo, blue glitch blocks and shards over the face, streak lines
//   'digital' - person cut out onto a dark-blue digital background, cool grade, horizontal pixel smears
//   'slice'   - the digital look cut into offset horizontal strips, with the face kept clear
// Person cut-out uses MediaPipe selfie segmentation; if it can't load, the camera guide silhouette is used.
// MediaPipe and its models are served from assets/vendor so the kiosk works offline.
(() => {
  const local = path => new URL(path, document.baseURI).href;
  const SEG_MODULE = local('assets/vendor/mediapipe/vision_bundle.mjs');
  const SEG_WASM = local('assets/vendor/mediapipe/wasm');
  const SEG_MODEL = local('assets/vendor/models/selfie_segmenter.tflite');
  const FACE_MODEL = local('assets/vendor/models/blaze_face_short_range.tflite');
  // Same head-and-shoulders outline as the camera guide, in 1024 x 1366 stage units.
  const GUIDE_PATH = 'M512 330c-110 0-185 88-185 210 0 92 40 168 98 205v52c-120 30-260 90-300 200v369h774V997c-40-110-180-170-300-200v-52c58-37 98-113 98-205 0-122-75-210-185-210z';

  let segmenterPromise = null;
  let faceDetectorPromise = null;
  let filesetPromise = null;

  function loadVision() {
    if (!filesetPromise) {
      filesetPromise = (async () => {
        const vision = await import(SEG_MODULE);
        return { vision, fileset: await vision.FilesetResolver.forVisionTasks(SEG_WASM) };
      })();
    }
    return filesetPromise;
  }

  function loadSegmenter() {
    if (!segmenterPromise) {
      segmenterPromise = loadVision().then(({ vision, fileset }) => vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: SEG_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        outputCategoryMask: false,
        outputConfidenceMasks: true,
      })).catch(err => {
        console.warn('Segmentation unavailable, falling back to guide silhouette', err);
        return null;
      });
    }
    return segmenterPromise;
  }

  function loadFaceDetector() {
    if (!faceDetectorPromise) {
      faceDetectorPromise = loadVision().then(({ vision, fileset }) => vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
      })).catch(err => {
        console.warn('Face detection unavailable, estimating the head from the person mask', err);
        return null;
      });
    }
    return faceDetectorPromise;
  }

  function preload() {
    return Promise.all([loadSegmenter(), loadFaceDetector()]);
  }

  // Largest detected face: { cx, top, w, h, eyeY } in canvas pixels, or null.
  async function detectFace(src, w, h) {
    const detector = await loadFaceDetector();
    if (!detector) return null;
    try {
      const faces = detector.detect(src).detections;
      if (!faces.length) return null;
      const face = faces.reduce((a, b) => (b.boundingBox.width * b.boundingBox.height > a.boundingBox.width * a.boundingBox.height ? b : a));
      const box = face.boundingBox;
      const [rightEye, leftEye] = face.keypoints;
      const eyeY = rightEye && leftEye ? ((rightEye.y + leftEye.y) / 2) * h : box.originY + box.height * 0.38;
      // The detector box is tight around the features; widen it to the whole head.
      return {
        cx: box.originX + box.width / 2,
        top: box.originY - box.height * 0.35,
        w: box.width * 1.1,
        h: box.height * 1.45,
        eyeY,
      };
    } catch (err) {
      console.warn('Face detection failed', err);
      return null;
    }
  }

  // Head position: from face detection when possible, otherwise from the person mask.
  async function locateHead(src, mask, w, h) {
    const face = await detectFace(src, w, h);
    if (face) return face;
    const head = headBox(mask, w, h);
    return { ...head, eyeY: head.top + head.h * 0.4 };
  }

  // ---------- helpers ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  function canvas(w, h) {
    return Object.assign(document.createElement('canvas'), { width: w, height: h });
  }

  function drawCover(ctx, img, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function hexToRgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }

  // Builds a 256-entry gradient lookup from colour stops.
  function gradientLut(stops) {
    const rgb = stops.map(hexToRgb);
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * (rgb.length - 1);
      const k = Math.min(rgb.length - 2, Math.floor(t)), f = t - k;
      for (let ch = 0; ch < 3; ch++) lut[i * 3 + ch] = rgb[k][ch] + (rgb[k + 1][ch] - rgb[k][ch]) * f;
    }
    return lut;
  }

  function mapPixels(ctx, w, h, fn) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let p = 0; p < d.length; p += 4) fn(d, p);
    ctx.putImageData(img, 0, 0);
  }

  const luminance = (d, p) => d[p] * 0.299 + d[p + 1] * 0.587 + d[p + 2] * 0.114;
  const contrast = (v, amount) => Math.max(0, Math.min(255, (v - 128) * amount + 128));

  // ---------- person mask ----------
  // With { fallback: false } it returns null instead of the guide silhouette when nobody is found (the
  // live outline must not draw a made-up person).
  async function personMask(src, w, h, { fallback = true } = {}) {
    const m = canvas(w, h);
    const ctx = m.getContext('2d');
    const seg = await loadSegmenter();
    if (seg) {
      try {
        const res = seg.segment(src);
        const mask = res.confidenceMasks[0];
        const mw = mask.width, mh = mask.height;
        const f = mask.getAsFloat32Array();
        const small = canvas(mw, mh);
        const sctx = small.getContext('2d');
        const img = sctx.createImageData(mw, mh);
        let covered = 0;
        for (let i = 0; i < f.length; i++) {
          img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
          img.data[i * 4 + 3] = f[i] * 255;
          if (f[i] > 0.5) covered++;
        }
        res.close?.();
        sctx.putImageData(img, 0, 0);
        const ratio = covered / f.length;
        if (ratio > 0.05 && ratio < 0.95) {
          ctx.filter = 'blur(2px)';
          ctx.drawImage(small, 0, 0, w, h);
          ctx.filter = 'none';
          return m;
        }
      } catch (err) {
        console.warn('Segmentation failed, using guide silhouette', err);
      }
    }
    if (!fallback) return null;
    ctx.save();
    ctx.filter = 'blur(10px)';
    ctx.scale(w / 1024, h / 1366);
    ctx.fillStyle = '#fff';
    ctx.fill(new Path2D(GUIDE_PATH));
    ctx.restore();
    return m;
  }

  // Head box from the mask: top of the person and the width of the first quarter below it.
  function headBox(mask, w, h) {
    const sw = 64, sh = Math.round(64 * h / w);
    const s = canvas(sw, sh);
    const sctx = s.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(mask, 0, 0, sw, sh);
    const a = sctx.getImageData(0, 0, sw, sh).data;
    const on = (x, y) => a[(y * sw + x) * 4 + 3] > 128;

    let top = -1;
    for (let y = 0; y < sh && top < 0; y++) for (let x = 0; x < sw; x++) if (on(x, y)) { top = y; break; }
    if (top < 0) return { cx: w * 0.5, top: h * 0.24, w: w * 0.36, h: h * 0.31 };

    let minX = sw, maxX = 0;
    const headRows = Math.round(sh * 0.2);
    for (let y = top; y < Math.min(sh, top + headRows); y++) {
      for (let x = 0; x < sw; x++) if (on(x, y)) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    const bw = Math.max(0.2, Math.min(0.6, (maxX - minX + 1) / sw)) * w;
    return { cx: ((minX + maxX + 1) / 2 / sw) * w, top: (top / sh) * h, w: bw, h: bw * 1.35 };
  }

  // ---------- shared effects ----------
  // Stacks of thin horizontal lines, like the glitch asset.
  function streakLines(ctx, x, y, width, count, colors) {
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = rand(0.25, 0.85);
      ctx.fillStyle = pick(colors);
      const lw = width * rand(0.4, 1);
      ctx.fillRect(x + rand(-width * 0.1, width * 0.1), y + i * rand(3, 6), lw, rand(1.5, 3.5));
    }
    ctx.globalAlpha = 1;
  }

  // Stretches a 1px column sideways across a band: the "pixel smear" look.
  function smear(ctx, x, y, length, height, dir = 1) {
    const sx = Math.max(0, Math.min(ctx.canvas.width - 1, x));
    if (dir > 0) ctx.drawImage(ctx.canvas, sx, y, 1, height, sx, y, length, height);
    else ctx.drawImage(ctx.canvas, sx, y, 1, height, sx - length, y, length, height);
  }

  function scanlines(ctx, w, h, alpha) {
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
  }

  function grain(ctx, w, h, amount) {
    mapPixels(ctx, w, h, (d, p) => {
      const n = (Math.random() - 0.5) * amount;
      d[p] += n; d[p + 1] += n; d[p + 2] += n;
    });
  }

  // One KV glitch shard, screen-blended, optionally mirrored and tilted.
  function kvShard(ctx, glitch, x, y, size, { alpha = 0.8, flip = false, rot = 0 } = {}) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = alpha;
    ctx.translate(x + size / 2, y + size / 2);
    ctx.rotate(rot);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(glitch, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  // Random KV shards across the frame, kept off the eyes. lowBias = share placed in the lower half.
  function scatterShards(ctx, glitch, w, h, head, count, { lowBias = 0.6, alpha = [0.5, 0.85], size = [0.25, 0.55] } = {}) {
    for (let i = 0; i < count; i++) {
      const s = w * rand(size[0], size[1]);
      const x = rand(-s * 0.35, w - s * 0.65);
      let y = Math.random() < lowBias ? rand(h * 0.5, h - s * 0.35) : rand(-s * 0.35, h * 0.5);
      const overEyes = y < head.eyeY + s * 0.1 && y + s * 0.85 > head.eyeY - head.h * 0.15
        && x + s * 0.85 > head.cx - head.w * 0.5 && x + s * 0.15 < head.cx + head.w * 0.5;
      if (overEyes) y = head.eyeY + head.h * 0.3;
      kvShard(ctx, glitch, x, y, s, { alpha: rand(alpha[0], alpha[1]), flip: Math.random() < 0.5, rot: rand(-0.25, 0.25) });
    }
  }

  // ---------- style: overlay ----------
  function styleOverlay(ctx, base, mask, glitch, w, h, head) {
    const fx = head.cx - head.w * 0.6, fy = head.top + head.h * 0.08;
    const fw = head.w * 1.25, fh = head.h * 1.25;

    // Black & white base.
    ctx.drawImage(base, 0, 0);
    mapPixels(ctx, w, h, (d, p) => {
      const l = contrast(luminance(d, p), 1.15);
      d[p] = d[p + 1] = d[p + 2] = l;
    });

    // Blue-toned copy, revealed only inside glitch blocks over the face and neck.
    const blue = canvas(w, h);
    const bctx = blue.getContext('2d', { willReadFrequently: true });
    bctx.drawImage(base, 0, 0);
    const lut = gradientLut(['#000514', '#06209a', '#1452ff', '#58a6ff', '#e6f4ff']);
    mapPixels(bctx, w, h, (d, p) => {
      const l = contrast(luminance(d, p), 1.3) | 0;
      d[p] = lut[l * 3]; d[p + 1] = lut[l * 3 + 1]; d[p + 2] = lut[l * 3 + 2];
    });

    const blocks = canvas(w, h);
    const kctx = blocks.getContext('2d');
    kctx.fillStyle = '#fff';
    for (let i = 0; i < 20; i++) {
      kctx.fillRect(rand(fx - fw * 0.05, fx + fw * 0.85), rand(fy - fh * 0.1, fy + fh * 0.85), fw * rand(0.08, 0.35), fh * rand(0.03, 0.12));
    }
    for (let i = 0; i < 8; i++) { // drips running down onto the neck
      const dx = rand(fx + fw * 0.1, fx + fw * 0.9);
      kctx.fillRect(dx, rand(fy + fh * 0.4, fy + fh * 0.7), fw * rand(0.03, 0.1), fh * rand(0.2, 0.5));
    }
    bctx.globalCompositeOperation = 'destination-in';
    bctx.drawImage(blocks, 0, 0);
    ctx.drawImage(blue, 0, 0);

    // Displaced blocks: chunks of the face shifted sideways and tinted.
    for (let i = 0; i < 7; i++) {
      const bw = fw * rand(0.15, 0.4), bh = fh * rand(0.03, 0.1);
      const bx = rand(fx, fx + fw - bw), by = rand(fy, fy + fh * 0.8);
      const shift = fw * rand(-0.12, 0.15);
      ctx.drawImage(ctx.canvas, bx, by, bw, bh, bx + shift, by, bw, bh);
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = pick(['rgba(20,90,255,.4)', 'rgba(60,170,255,.3)', 'rgba(0,30,160,.35)']);
      ctx.fillRect(bx + shift, by, bw, bh);
      ctx.globalCompositeOperation = 'source-over';
    }

    // KV shards: one on the lower face and neck, the rest scattered, mostly low in the frame.
    const gs = fw * 1.2;
    kvShard(ctx, glitch, head.cx - gs * 0.4, fy + fh * 0.45, gs, { alpha: 0.85 });
    scatterShards(ctx, glitch, w, h, head, Math.round(rand(4, 6)), { lowBias: 0.7, alpha: [0.55, 0.9] });

    // Streak lines at the sides of the face.
    const lineColors = ['#cfe6ff', '#8fc2ff', '#4f8dff', '#ffffff', '#b9a6ff'];
    for (let i = 0; i < 6; i++) {
      const left = Math.random() < 0.4;
      const sx = left ? fx - fw * rand(0.2, 0.5) : fx + fw * rand(0.6, 1.0);
      streakLines(ctx, sx, rand(fy + fh * 0.1, fy + fh * 1.0), fw * rand(0.25, 0.6), Math.round(rand(5, 16)), lineColors);
    }

    // A few pixel smears through the blue area.
    for (let i = 0; i < 3; i++) {
      smear(ctx, rand(fx + fw * 0.4, fx + fw * 0.8), rand(fy + fh * 0.2, fy + fh * 0.8), fw * rand(0.15, 0.45), rand(3, 14));
    }

    scanlines(ctx, w, h, 0.05);
    grain(ctx, w, h, 14);
  }

  // ---------- style: digital ----------
  function digitalBackground(ctx, glitch, w, h) {
    const bg = ctx.createRadialGradient(w * 0.5, h * 0.35, 0, w * 0.5, h * 0.5, h * 0.8);
    bg.addColorStop(0, '#0a1e6e');
    bg.addColorStop(0.5, '#040b33');
    bg.addColorStop(1, '#01030f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const colors = ['#0a1a6b', '#1238c9', '#1f63ff', '#3fa0ff', '#0b0f3a', '#5a2bd6', '#0e2a8f', '#2bd4ff'];
    for (let i = 0; i < 260; i++) {
      ctx.globalAlpha = rand(0.15, 0.7);
      ctx.fillStyle = pick(colors);
      ctx.fillRect(rand(-20, w), rand(-20, h), rand(8, w * 0.18), rand(4, h * 0.08));
    }
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#e0306b';
    for (let i = 0; i < 6; i++) ctx.fillRect(rand(0, w), rand(0, h), rand(3, 8), rand(20, 80));

    // Bright speckles in clusters, like light through crystal.
    ctx.globalCompositeOperation = 'lighter';
    for (let c = 0; c < 18; c++) {
      const cx = rand(0, w), cy = rand(0, h), r = rand(30, 140);
      for (let i = 0; i < 70; i++) {
        ctx.globalAlpha = rand(0.1, 0.6);
        ctx.fillStyle = pick(['#6fd6ff', '#9fe8ff', '#3d7bff']);
        ctx.fillRect(cx + rand(-r, r), cy + rand(-r, r), rand(1, 3), rand(1, 3));
      }
    }

    // Soft flowing light ribbons.
    ctx.globalAlpha = 1;
    ctx.shadowColor = 'rgba(80,170,255,.9)';
    for (let i = 0; i < 7; i++) {
      ctx.shadowBlur = rand(20, 50);
      ctx.strokeStyle = `rgba(110,190,255,${rand(0.08, 0.25)})`;
      ctx.lineWidth = rand(2, 22);
      ctx.beginPath();
      const y0 = rand(0, h);
      ctx.moveTo(-50, y0);
      ctx.bezierCurveTo(w * 0.3, y0 + rand(-h * 0.3, h * 0.3), w * 0.7, y0 + rand(-h * 0.3, h * 0.3), w + 50, y0 + rand(-h * 0.2, h * 0.2));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 3; i++) {
      const s = w * rand(0.6, 1.1);
      ctx.globalAlpha = rand(0.35, 0.6);
      ctx.drawImage(glitch, rand(-s * 0.5, w - s * 0.5), rand(-s * 0.3, h - s * 0.5), s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function styleDigital(ctx, base, mask, glitch, w, h, head) {
    const fx = head.cx - head.w * 0.55, fy = head.top + head.h * 0.1;
    const fw = head.w * 1.1, fh = head.h * 1.1;

    digitalBackground(ctx, glitch, w, h);

    // Cool-graded person cut out from the photo.
    const p = canvas(w, h);
    const pctx = p.getContext('2d', { willReadFrequently: true });
    pctx.drawImage(base, 0, 0);
    mapPixels(pctx, w, h, (d, i) => {
      const l = luminance(d, i);
      const r = d[i] * 0.55 + l * 0.45, g = d[i + 1] * 0.55 + l * 0.45, b = d[i + 2] * 0.55 + l * 0.45;
      const shadow = 1 - l / 255;
      d[i] = contrast(r * (0.92 - shadow * 0.25), 1.12);
      d[i + 1] = contrast(g * (0.98 - shadow * 0.1), 1.12);
      d[i + 2] = contrast(b * 1.03 + shadow * 22, 1.12);
    });
    pctx.globalCompositeOperation = 'destination-in';
    pctx.drawImage(mask, 0, 0);

    // Blue rim glow behind the person.
    const glow = canvas(w, h);
    const gctx = glow.getContext('2d');
    gctx.filter = 'blur(28px)';
    gctx.drawImage(mask, 0, 0);
    gctx.filter = 'none';
    gctx.globalCompositeOperation = 'source-in';
    gctx.fillStyle = 'rgba(60,140,255,.55)';
    gctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(glow, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    // KV shards behind the person, at the shoulders.
    kvShard(ctx, glitch, head.cx - head.w * 2.1, head.eyeY + head.h * 0.2, w * 0.55, { alpha: 0.75, rot: rand(-0.2, 0.2) });
    kvShard(ctx, glitch, head.cx + head.w * 0.4, head.eyeY + head.h * 0.35, w * 0.55, { alpha: 0.75, flip: true, rot: rand(-0.2, 0.2) });

    ctx.drawImage(p, 0, 0);

    // Light wrap: a little of the blue glow spills onto the person's edges.
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.2;
    ctx.drawImage(glow, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Pixel smears on their own layer, tinted blue and laid over semi-transparently so they blend in.
    const side = Math.random() < 0.5 ? 1 : -1;
    const edge = side > 0 ? fx + fw * 0.62 : fx + fw * 0.38;
    const smears = canvas(w, h);
    const sctx = smears.getContext('2d');
    const smearOnto = (x, y, length, height) => {
      const sx = Math.max(0, Math.min(w - 1, x));
      sctx.drawImage(ctx.canvas, sx, y, 1, height, side > 0 ? sx : sx - length, y, length, height);
    };
    for (let y = fy + fh * 0.05; y < fy + fh * 0.95; y += rand(4, 14)) { // light, off the far side of the face
      if (Math.random() < 0.65) smearOnto(edge + side * rand(0, fw * 0.2), y, fw * rand(0.08, 0.55), rand(3, 9));
    }
    for (let y = fy + fh * 0.95; y < Math.min(h, fy + fh * 1.9); y += rand(3, 10)) { // dark, across neck and shoulders
      if (Math.random() < 0.7) smearOnto(edge + side * rand(-fw * 0.1, fw * 0.15), y, fw * rand(0.1, 0.7), rand(2, 7));
    }
    sctx.globalCompositeOperation = 'source-atop';
    sctx.fillStyle = 'rgba(70,140,255,.15)';
    sctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.7;
    ctx.drawImage(smears, 0, 0);
    ctx.globalAlpha = 1;

    // KV shards in front: lower frame, and a faint one across the smeared side of the face.
    scatterShards(ctx, glitch, w, h, head, 2, { lowBias: 1, alpha: [0.6, 0.8], size: [0.35, 0.5] });
    kvShard(ctx, glitch, edge - fw * (side > 0 ? 0.1 : 0.6), fy + fh * 0.35, fw * 0.7, { alpha: 0.45, flip: side < 0 });

    // Colour unify: wash the whole frame in the KV blue so person and background sit together.
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = 'rgba(31,85,214,.15)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    // Glitch blocks crossing the face edge.
    ctx.globalCompositeOperation = 'screen';
    for (let i = 0; i < 10; i++) {
      ctx.globalAlpha = rand(0.2, 0.5);
      ctx.fillStyle = pick(['#3d7bff', '#7fc8ff', '#1238c9']);
      ctx.fillRect(edge + rand(-fw * 0.2, fw * 0.3), rand(fy, fy + fh), fw * rand(0.05, 0.3), fh * rand(0.01, 0.05));
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    chromaticShift(ctx, w, h, 7);
    scanlines(ctx, w, h, 0.06);
    grain(ctx, w, h, 10);
  }

  // RGB split: red pushed right, blue pushed left, with a few horizontal bands split much harder.
  function chromaticShift(ctx, w, h, px) {
    const img = ctx.getImageData(0, 0, w, h);
    const src = new Uint8ClampedArray(img.data);
    const d = img.data;
    const rowShift = new Int16Array(h).fill(px);
    for (let b = 0; b < 10; b++) {
      const y0 = Math.floor(rand(0, h)), bh = Math.floor(rand(4, 40)), extra = Math.round(rand(px, px * 4));
      for (let y = y0; y < Math.min(h, y0 + bh); y++) rowShift[y] = extra;
    }
    for (let y = 0; y < h; y++) {
      const s = rowShift[y];
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = Math.max(0, x - s), b = Math.min(w - 1, x + s);
        d[i] = src[(y * w + r) * 4];
        d[i + 2] = src[(y * w + b) * 4 + 2];
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  // ---------- style: slice ----------
  const KV_BLUE = ['#04123a', '#0b3fb8', '#2f8cff', '#9fe8ff', '#ffffff'];
  const KV_CYAN = ['#00060f', '#004a6e', '#00d1d2', '#9ffcff', '#ffffff'];
  const KV_NEG = ['#ffffff', '#9fe8ff', '#2f8cff', '#0b3fb8', '#04123a'];

  function copy(src) {
    const c = canvas(src.width, src.height);
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  }

  function tint(src, stops) {
    const c = copy(src);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const lut = gradientLut(stops);
    mapPixels(ctx, c.width, c.height, (d, p) => {
      const l = contrast(luminance(d, p), 1.15) | 0;
      d[p] = lut[l * 3]; d[p + 1] = lut[l * 3 + 1]; d[p + 2] = lut[l * 3 + 2];
    });
    return c;
  }

  // The digital look cut into offset horizontal strips in mixed tints, with the face kept readable.
  function styleSlice(ctx, base, mask, glitch, w, h, head) {
    styleDigital(ctx, base, mask, glitch, w, h, head);

    const nat = copy(ctx.canvas);
    const variants = [
      { img: nat, weight: 4 },
      { img: tint(nat, KV_BLUE), weight: 4 },
      { img: tint(nat, KV_CYAN), weight: 1.5 },
      { img: tint(nat, KV_NEG), weight: 1 },
    ];
    const total = variants.reduce((s, v) => s + v.weight, 0);
    const pickVariant = () => {
      let r = Math.random() * total;
      for (const v of variants) if ((r -= v.weight) <= 0) return v.img;
      return nat;
    };

    for (let y = 0; y < h;) {
      const sh = rand(6, 70);
      const inFace = y > head.top - head.h * 0.1 && y < head.eyeY + head.h * 1.2;
      if (Math.random() < (inFace ? 0.7 : 0.35)) {
        const off = Math.random() < 0.3 ? 0 : rand(-1, 1) * w * (inFace ? 0.08 : 0.03);
        ctx.drawImage(pickVariant(), 0, y, w, sh, off, y, w, sh);
      }
      y += sh;
    }

    scatterShards(ctx, glitch, w, h, head, 2, { lowBias: 0.7, alpha: [0.5, 0.75] });
    chromaticShift(ctx, w, h, 4); // on top of the digital look's own split, so the strips split too

    // Keep the face readable: lay the un-sliced digital look back over it, feathered at the edges.
    const face = copy(nat);
    const fctx = face.getContext('2d');
    const cy = head.eyeY + head.h * 0.12;
    const rx = head.w * 0.62, ry = head.h * 0.58;
    fctx.globalCompositeOperation = 'destination-in';
    fctx.save();
    fctx.translate(head.cx, cy);
    fctx.scale(rx / ry, 1);
    const feather = fctx.createRadialGradient(0, 0, 0, 0, 0, ry);
    feather.addColorStop(0, 'rgba(0,0,0,1)');
    feather.addColorStop(0.72, 'rgba(0,0,0,1)');
    feather.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = feather;
    fctx.fillRect(-ry, -ry, ry * 2, ry * 2);
    fctx.restore();
    ctx.drawImage(face, 0, 0);

    // Just a few thin, small-offset strips across the face as a hint of the glitch.
    for (let i = Math.round(rand(2, 3)); i > 0; i--) {
      const sy = rand(cy - ry * 0.7, cy + ry * 0.7), sh = rand(3, 8);
      ctx.drawImage(pickVariant(), 0, sy, w, sh, rand(-1, 1) * w * 0.02, sy, w, sh);
    }

    scanlines(ctx, w, h, 0.05);
  }

  // ---------- public ----------
  const STYLES = { overlay: styleOverlay, digital: styleDigital, slice: styleSlice };

  // The blue scanline texture (assets/glitch-texture.webp), screen-blended over every result.
  let texturePromise = null;
  function loadTexture() {
    if (!texturePromise) {
      texturePromise = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = local('assets/glitch-texture.webp');
      });
    }
    return texturePromise;
  }

  // Strong on the background, only a hint on the person so the face stays clean.
  function applyTexture(ctx, texture, mask, w, h) {
    const tex = canvas(w, h);
    drawCover(tex.getContext('2d'), texture, w, h);
    const bg = copy(tex);
    const bctx = bg.getContext('2d');
    bctx.globalCompositeOperation = 'destination-out';
    bctx.drawImage(mask, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = 0.75;
    ctx.drawImage(bg, 0, 0);
    ctx.globalAlpha = 0.15;
    ctx.drawImage(tex, 0, 0);
    ctx.restore();
  }

  async function render(photo, glitch, { width, height, style }) {
    const base = canvas(width, height);
    drawCover(base.getContext('2d'), photo, width, height);
    const mask = await personMask(base, width, height);
    const head = await locateHead(base, mask, width, height);

    const out = canvas(width, height);
    const ctx = out.getContext('2d', { willReadFrequently: true });
    STYLES[style](ctx, base, mask, glitch, width, height, head);
    try {
      applyTexture(ctx, await loadTexture(), mask, width, height);
    } catch (err) {
      console.warn('Glitch texture unavailable', err);
    }
    return out.toDataURL('image/jpeg', 0.9);
  }

  // Face check for the camera step: { found, width } where width is the face width as a share of the
  // image width; { found: null } when the detector isn't available (then the check is skipped).
  async function checkFace(img) {
    if (!(await loadFaceDetector())) return { found: null };
    const w = 480, h = Math.round(480 * img.height / img.width);
    const c = canvas(w, h);
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const face = await detectFace(c, w, h);
    return face ? { found: true, width: face.w / 1.1 / w } : { found: false };
  }

  window.GlitchArt = {
    render,
    preload,
    checkFace,
    styles: Object.keys(STYLES),
    // Shared with glitch-video.js.
    internals: {
      canvas, copy, tint, drawCover, personMask, locateHead, gradientLut, mapPixels, luminance, contrast, rand, pick,
      kvShard, scatterShards, chromaticShift, scanlines, grain, KV_BLUE, KV_CYAN, KV_NEG, loadTexture,
    },
  };
})();
