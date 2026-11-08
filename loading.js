// Loading-screen card animations. Three variants, all CSS transform/opacity animation so they stay
// smooth while the page is busy rendering the art:
//   'scan'     - the photo glitching: shifting slices, RGB split, a sweeping scan line
//   'assemble' - the photo starts as scattered glitch fragments that jump about and lock together
//   'decode'   - the photo resolves from big blocky pixels with an RGB split to sharp, like a signal decoding
//   'storm'    - the whole screen breaks into glitch (sliced background, RGB split, flashing KV shards,
//                strobe), then calms down and the photo card settles in the middle; small blips after that
window.LoadingFx = (() => {
  const VARIANTS = ['storm', 'scan', 'assemble', 'decode'];
  const CARD_ASPECT = 570 / 757;
  const rand = (a, b) => a + Math.random() * (b - a);

  // Shared layers on top of every variant: KV blue tint and flickering KV shards.
  const OVERLAY = `
    <div class="loading-step__tint"></div>
    <div class="loading-step__shard loading-step__shard--a"></div>
    <div class="loading-step__shard loading-step__shard--b"></div>`;

  function scan(photo) {
    const slices = [[12, 80, 1.1, -.2], [31, 63, .9, -.5], [44, 50, 1.3, -.1], [58, 37, .8, -.7], [71, 22, 1.2, -.3], [86, 9, 1, -.6]]
      .map(([t, b, d, delay]) => `<img class="card-step__media loading-step__slice" style="--t: ${t}%; --b: ${b}%; --d: ${d}s; --delay: ${delay}s" src="${photo}" alt="">`)
      .join('');
    return `
      <img class="card-step__media loading-step__base" src="${photo}" alt="">
      <img class="card-step__media loading-step__rgb loading-step__rgb--r" src="${photo}" alt="">
      <img class="card-step__media loading-step__rgb loading-step__rgb--c" src="${photo}" alt="">
      ${slices}${OVERLAY}
      <div class="loading-step__scan"></div>`;
  }

  // A grid of tiles, each the whole photo clipped to its own cell, flung out and jumping back into place.
  function assemble(photo) {
    const cols = 6, rows = 8;
    let tiles = '';
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const inset = `${(r / rows * 100).toFixed(2)}% ${((cols - c - 1) / cols * 100).toFixed(2)}% ${((rows - r - 1) / rows * 100).toFixed(2)}% ${(c / cols * 100).toFixed(2)}%`;
        const x = rand(-70, 70).toFixed(1), y = rand(-45, 45).toFixed(1);
        const tint = Math.random() < 0.3 ? ' lv-tile--tint' : '';
        tiles += `<img class="card-step__media lv-tile${tint}" style="clip-path: inset(${inset}); --x: ${x}%; --y: ${y}%; --delay: ${rand(0, .5).toFixed(2)}s" src="${photo}" alt="">`;
      }
    }
    return `${tiles}
      <img class="card-step__media lv-whole" src="${photo}" alt="">
      ${OVERLAY}
      <div class="lv-flash"></div>`;
  }

  // Pixelated copies of the photo (made once, on a small canvas) shown coarse to fine.
  const DECODE_WIDTHS = [10, 18, 32, 60, 120];
  async function decode(photo) {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = photo;
    });
    // Crop to the card's shape first, as object-fit: cover would.
    let sw = img.width, sh = img.width / CARD_ASPECT;
    if (sh > img.height) { sh = img.height; sw = img.height * CARD_ASPECT; }
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    const layers = DECODE_WIDTHS.map((w, i) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = Math.round(w / CARD_ASPECT);
      c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      return `<img class="card-step__media lv-pixel" style="--i: ${i}" src="${c.toDataURL()}" alt="">`;
    }).join('');
    return `${layers}
      <img class="card-step__media lv-pixel lv-pixel--sharp" style="--i: ${DECODE_WIDTHS.length}" src="${photo}" alt="">
      <img class="card-step__media lv-split lv-split--r" src="${photo}" alt="">
      <img class="card-step__media lv-split lv-split--c" src="${photo}" alt="">
      ${OVERLAY}
      <div class="lv-noise"></div>`;
  }

  // Card part of the storm: the photo violently sliced and split, settling, then idling with small blips.
  function storm(photo) {
    const slices = [[6, 84], [18, 70], [33, 58], [47, 45], [60, 31], [74, 17], [88, 4]]
      .map(([t, b], i) => {
        const dx = (rand(14, 40) * (i % 2 ? 1 : -1)).toFixed(1);
        return `<img class="card-step__media lv-storm-slice" style="--t: ${t}%; --b: ${b}%; --dx: ${dx}%; --d: ${rand(1.6, 2.6).toFixed(2)}s" src="${photo}" alt="">`;
      }).join('');
    return `
      <img class="card-step__media loading-step__base" src="${photo}" alt="">
      <img class="card-step__media lv-storm-rgb lv-storm-rgb--r" src="${photo}" alt="">
      <img class="card-step__media lv-storm-rgb lv-storm-rgb--c" src="${photo}" alt="">
      ${slices}${OVERLAY}`;
  }

  // Full-screen part of the storm, laid over the app background.
  function stormScreen() {
    const bands = [[0, 86], [14, 74], [26, 63], [37, 52], [48, 40], [60, 28], [72, 15], [85, 0]]
      .map(([t, b], i) => `<div class="lfx-band" style="clip-path: inset(${t}% 0 ${b}% 0); --dx: ${(rand(6, 22) * (i % 2 ? 1 : -1)).toFixed(1)}vw"></div>`)
      .join('');
    const shards = Array.from({ length: 4 }, () =>
      `<div class="lfx-shard" style="left: ${rand(-20, 70).toFixed(0)}%; top: ${rand(-20, 60).toFixed(0)}%; --s: ${rand(35, 70).toFixed(0)}vh; --flip: ${Math.random() < 0.5 ? -1 : 1}; animation-delay: ${rand(0, .5).toFixed(2)}s"></div>`).join('');
    return `${bands}
      <div class="lfx-rgb lfx-rgb--r"></div><div class="lfx-rgb lfx-rgb--c"></div>
      ${shards}
      <div class="lfx-bars"></div>
      <div class="lfx-strobe"></div>`;
  }

  const BUILD = { storm, scan, assemble, decode };
  const SCREEN = { storm: stormScreen };
  const objectUrls = new WeakMap();

  // Fills `card` with the given variant for `photo` (a data URL or image URL), and `screen` (optional)
  // with its full-screen layer, if the variant has one. A data URL is turned into a short blob URL first,
  // so the many layers don't each carry the whole image in the markup.
  async function setup(card, photo, variant = 'storm', screen = null) {
    const name = BUILD[variant] ? variant : 'storm';
    let src = photo;
    if (photo.startsWith('data:')) {
      URL.revokeObjectURL(objectUrls.get(card));
      src = URL.createObjectURL(await (await fetch(photo)).blob());
      objectUrls.set(card, src);
    }
    card.dataset.variant = name;
    card.innerHTML = await BUILD[name](src);
    // The card element is reused between visitors: restart its own animation too.
    card.style.animation = 'none';
    void card.offsetWidth;
    card.style.animation = '';
    if (screen) {
      screen.dataset.variant = name;
      screen.innerHTML = SCREEN[name] ? SCREEN[name]() : '';
    }
  }

  return { setup, VARIANTS };
})();
