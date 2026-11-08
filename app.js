// Flow: welcome -> camera -> preview -> result. Terms modal opens from the welcome step.
const COUNTDOWN_FROM = 3;
const COUNTDOWN_STEP_MS = 1000;
const OUTPUT_W = 1080;
const OUTPUT_H = Math.round(OUTPUT_W * 1366 / 1024);

const $ = sel => document.querySelector(sel);
const steps = [...document.querySelectorAll('.step')];
const video = $('#video');
const state = { step: null, stream: null, photo: null, art: null, busy: false };

// ---------- navigation ----------
function go(name) {
  if (state.step === 'camera' && name !== 'camera') stopCamera();
  if (state.step === 'preview' && name !== 'preview') previewOutline?.clear();
  if (state.step === 'loading' && name !== 'loading') window.LoadingFx.clear($('#loadingCard'), $('#loadingScreen'));
  if (name !== 'result') stopResultTimer(); // on the result screen it starts once the QR code is up
  state.step = name;
  $('.app-layout').dataset.screen = name; // lets the background arrange itself per screen
  steps.forEach(s => s.classList.toggle('is-active', s.dataset.step === name));
  if (name === 'camera') startCamera();
}

function home() {
  publishRun++;
  state.photo = null;
  state.art = null;
  state.busy = false;
  clearResult();
  go('welcome');
}

// ---------- terms ----------
const terms = $('#terms');
const openTerms = () => { terms.hidden = false; };
const closeTerms = () => { terms.hidden = true; };

// ---------- camera ----------
const cameraHint = $('#cameraHint');
const captureBtn = $('#captureBtn');
const cameraView = $('#cameraView');
const countdownEl = $('#countdown');

async function startCamera() {
  cameraHint.hidden = true;
  cameraView.classList.remove('is-live', 'is-error');
  captureBtn.disabled = true;
  setButtonLabel(captureBtn, 'Start');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1440 }, height: { ideal: 1920 } },
    });
    video.srcObject = state.stream;
    await video.play();
    cameraView.classList.add('is-live');
    captureBtn.disabled = false;
    startFaceWatch();
    startOutline();
  } catch (err) {
    console.error(err);
    cameraView.classList.add('is-error');
    // Upload is hidden for now, so only point to the staff (was: "Upload a photo or ask the staff").
    showCameraError($('#uploadBtn').hidden ? 'Camera is not available<br>Please ask the staff' : 'Camera is not available<br>Upload a photo or ask the staff');
  }
}

function stopCamera() {
  stopFaceWatch();
  stopOutline();
  state.stream?.getTracks().forEach(t => t.stop());
  state.stream = null;
  video.srcObject = null;
  cameraView.classList.remove('is-live');
  countdownEl.hidden = true;
}

// ---------- live face watch ----------
// While the camera runs, check a few times a second whether someone is in the card, so the visitor is
// told before pressing Start. Start stays disabled while nobody is there; standing too far back only
// shows a hint. Paused during the countdown.
const WATCH_MS = 350;
const WATCH_MISSES = 2; // checks in a row without a face before saying so, so a quick move doesn't flicker
const TOO_FAR_LIVE = 'You are far from the camera<br>Step closer for a better artwork';
const watch = { timer: null, misses: 0, frame: document.createElement('canvas') };

function startFaceWatch() {
  stopFaceWatch();
  watch.misses = 0;
  const tick = async () => {
    if (state.step !== 'camera' || !state.stream) return;
    if (!state.busy && video.videoWidth) {
      let check = { found: null };
      try {
        check = await window.GlitchArt.checkFace(cardFrame(watch.frame, 480));
      } catch (err) {
        console.warn('Live face check failed', err);
      }
      if (!state.busy && state.step === 'camera') applyFaceWatch(check);
    }
    watch.timer = setTimeout(tick, WATCH_MS);
  };
  watch.timer = setTimeout(tick, 200);
}

function stopFaceWatch() {
  clearTimeout(watch.timer);
  watch.timer = null;
}

function applyFaceWatch(check) {
  if (captureBtn.dataset.retry) return;
  if (check.found === null) { captureBtn.disabled = false; return; } // no detector: never block the visitor
  if (check.found === false) {
    if (++watch.misses >= WATCH_MISSES) {
      cameraHint.innerHTML = NOT_IN_FRAME;
      cameraHint.hidden = false;
      captureBtn.disabled = true;
    }
    return;
  }
  watch.misses = 0;
  captureBtn.disabled = false;
  if (check.width < MIN_FACE_WIDTH) {
    cameraHint.innerHTML = TOO_FAR_LIVE;
    cameraHint.hidden = false;
  } else {
    cameraHint.hidden = true;
  }
}

// ---------- live person outline ----------
// A dashed cyan line around the visitor, with the area around them dark navy, while the camera runs
// (outline.js), traced about ten times a second from the person mask. Also drawn once on the still
// photo in the preview.
const OUTLINE_MS = 100;
const cameraOutline = window.PersonOutline?.overlay($('#cameraOutline'));
const previewOutline = window.PersonOutline?.overlay($('#previewOutline'));
const outlineWatch = { timer: null, frame: document.createElement('canvas') };

function startOutline() {
  stopOutline();
  if (!cameraOutline) return;
  const tick = async () => {
    if (state.step !== 'camera' || !state.stream) return;
    if (video.videoWidth) {
      try {
        const pts = await window.PersonOutline.trace(cardFrame(outlineWatch.frame, 240));
        if (state.step === 'camera' && outlineWatch.timer) cameraOutline.update(pts);
      } catch (err) {
        console.warn('Live outline failed', err);
      }
    }
    if (outlineWatch.timer) outlineWatch.timer = setTimeout(tick, OUTLINE_MS);
  };
  outlineWatch.timer = setTimeout(tick, 250);
}

function stopOutline() {
  clearTimeout(outlineWatch.timer);
  outlineWatch.timer = null;
  cameraOutline?.clear();
}

async function outlinePreview(photo) {
  previewOutline?.clear();
  if (!previewOutline) return;
  try {
    const pts = await window.PersonOutline.trace(await loadImage(photo));
    if (state.photo === photo && state.step === 'preview') previewOutline.update(pts);
  } catch (err) {
    console.warn('Preview outline failed', err);
  }
}

function showCameraError(html) {
  cameraHint.innerHTML = html;
  cameraHint.hidden = false;
  captureBtn.disabled = false;
  setButtonLabel(captureBtn, 'Try again');
  captureBtn.dataset.retry = '1';
}

async function capture() {
  if (captureBtn.dataset.retry) {
    delete captureBtn.dataset.retry;
    stopCamera();
    return startCamera();
  }
  if (state.busy || !state.stream) return;
  state.busy = true;
  captureBtn.disabled = true;

  countdownEl.hidden = false;
  for (let n = COUNTDOWN_FROM; n > 0; n--) {
    countdownEl.innerHTML = `<span>${n}</span>`;
    await wait(COUNTDOWN_STEP_MS);
    if (state.step !== 'camera') { state.busy = false; return; }
  }
  countdownEl.hidden = true;

  captureBtn.classList.add('is-loading');
  await usePhoto(grabFrame());
  captureBtn.classList.remove('is-loading');
  captureBtn.disabled = false;
  state.busy = false;
}

// ---------- face check ----------
// A face narrower than this share of the frame means the visitor stood too far back. A well-framed
// face measures about 0.4; the detector gets unreliable below about 0.2.
const MIN_FACE_WIDTH = 0.25;
const NOT_IN_FRAME = "We couldn't find you in the frame<br>Step into the frame and try again";
const TOO_FAR = 'You are far from the camera<br>Retake and step closer for a better artwork';

// No face: stay on the camera step and say so. Face too small: continue, but suggest a retake.
async function usePhoto(photo) {
  let check = { found: null };
  try {
    check = await window.GlitchArt.checkFace(await loadImage(photo));
  } catch (err) {
    console.warn('Face check failed, continuing without it', err);
  }
  if (check.found === false) {
    cameraHint.innerHTML = NOT_IN_FRAME;
    cameraHint.hidden = false;
    return;
  }
  cameraHint.hidden = true;
  showPreview(photo, check.found && check.width < MIN_FACE_WIDTH ? TOO_FAR : null);
}

function showPreview(photo, hint = null) {
  state.photo = photo;
  $('#previewImg').src = photo;
  resetPreview();
  if (hint) {
    previewHint.innerHTML = hint;
    previewHint.hidden = false;
  }
  go('preview');
  outlinePreview(photo);
}

// ---------- upload ----------
const uploadInput = $('#uploadInput');

function openUpload() {
  if (state.busy) return;
  uploadInput.value = '';
  uploadInput.click();
}

uploadInput.addEventListener('change', async () => {
  const file = uploadInput.files[0];
  if (!file || state.busy) return;
  state.busy = true;
  const uploadBtn = $('#uploadBtn');
  uploadBtn.classList.add('is-loading');
  const url = URL.createObjectURL(file);
  try {
    await usePhoto(cropToStage(await loadImage(url)));
  } catch (err) {
    console.error(err);
    cameraHint.textContent = "This file couldn't be opened. Try another photo";
    cameraHint.hidden = false;
  } finally {
    URL.revokeObjectURL(url);
    uploadBtn.classList.remove('is-loading');
    state.busy = false;
  }
});

// Centre-crops an uploaded image to the same frame shape as a camera capture (not mirrored).
function cropToStage(img) {
  const box = $('.camera-view').getBoundingClientRect();
  const target = box.width / box.height;
  let sw = img.width, sh = img.width / target;
  if (sh > img.height) { sh = img.height; sw = img.height * target; }
  const w = OUTPUT_W, h = Math.round(OUTPUT_W / target);
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  c.getContext('2d').drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.92);
}

// Crops the mirrored video to the card's aspect ratio, exactly as it appears on screen.
function grabFrame() {
  return cardFrame(document.createElement('canvas'), OUTPUT_W).toDataURL('image/jpeg', 0.92);
}

// Draws the part of the video that the card shows into `c`, `width` pixels wide, mirrored like the
// on-screen preview.
function cardFrame(c, width) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const box = video.getBoundingClientRect();
  const target = box.width / box.height;
  let sw = vw, sh = vw / target;
  if (sh > vh) { sh = vh; sw = vh * target; }
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;

  c.width = width;
  c.height = Math.round(width / target);
  const ctx = c.getContext('2d');
  ctx.setTransform(-1, 0, 0, 1, c.width, 0);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

// ---------- preview ----------
const previewHint = $('#previewHint');
const nextBtn = $('#nextBtn');
const retakeBtn = $('#retakeBtn');

function resetPreview() {
  previewHint.hidden = true;
  nextBtn.classList.remove('is-loading');
  nextBtn.disabled = false;
  retakeBtn.disabled = false;
  setButtonLabel(nextBtn, 'Next');
}

// Next moves to the loading screen while the art is made, then on to the result. On failure it comes
// back to the preview with a Try again.
async function submit() {
  if (state.busy) return;
  state.busy = true;
  await showLoading(state.photo);
  try {
    state.art = await generateArt(state.photo, setProgress);
    setProgress(1);
    await wait(400);
    showResult();
  } catch (err) {
    console.error(err);
    go('preview');
    setButtonLabel(nextBtn, 'Try again');
    previewHint.textContent = 'Something went wrong';
    previewHint.hidden = false;
  } finally {
    stopCreep();
    state.busy = false;
  }
}

// ---------- loading ----------
const loadingBar = $('#loadingBar');
const loadingStatus = $('#loadingStatus');
// One message the whole time (client request). The earlier step-by-step messages, kept for reference:
// [0, 'Scanning your face…'], [0.25, 'Removing the background…'], [0.5, 'Injecting glitch…'],
// [0.75, 'Creating your artwork…']
const LOADING_STATUS = [
  [0, 'Your AI art is in progress…'], // was 'Creating your artwork…'
];
const progress = { value: 0, creep: null };
// Loading animation (loading.js): 'storm' (full screen), 'scan', 'assemble' or 'decode'.
// Try another with ?loading=decode.
const LOADING_VARIANT = new URLSearchParams(location.search).get('loading') || 'storm';

async function showLoading(photo) {
  // Show the photo with the area around the person dark navy, like the camera and preview screens.
  let shown = photo;
  try {
    shown = (await window.PersonOutline?.navyBacked(await loadImage(photo))) || photo;
  } catch (err) {
    console.warn('Navy backdrop for loading failed, using the plain photo', err);
  }
  await window.LoadingFx.setup($('#loadingCard'), shown, LOADING_VARIANT, $('#loadingScreen'));
  progress.value = 0;
  loadingBar.style.transition = 'none';
  setProgress(0);
  loadingBar.offsetWidth; // apply the reset before re-enabling the transition
  loadingBar.style.transition = '';
  go('loading');
}

// Progress only ever moves forward; the status line follows it.
function setProgress(p) {
  progress.value = Math.max(progress.value, Math.min(1, p));
  loadingBar.style.transform = `scaleX(${progress.value})`;
  loadingStatus.textContent = LOADING_STATUS.filter(([at]) => progress.value >= at).pop()[1];
}

// Inches the bar towards `cap` while work without its own progress (segmentation, photo styles) runs.
function creepTo(cap) {
  stopCreep();
  progress.creep = setInterval(() => {
    if (progress.value < cap) setProgress(progress.value + (cap - progress.value) * 0.08 + 0.002);
  }, 120);
}

function stopCreep() {
  clearInterval(progress.creep);
  progress.creep = null;
}

// ---------- art generation ----------
// The five approved results. Only the enabled ones are used; with several enabled, each visitor gets
// one at random (never the same one twice in a row). The client picked Pulse, now in its calm version;
// the others stay here, switched off, so they can come back by setting `enabled: true`.
const ALL_RESULTS = [
  { kind: 'photo', style: 'overlay', enabled: false },
  { kind: 'photo', style: 'digital', enabled: false },
  { kind: 'photo', style: 'slice', enabled: false },
  { kind: 'video', style: 'halfface', enabled: false },
  { kind: 'video', style: 'pulse', enabled: false },
  { kind: 'video', style: 'pulseSoft', enabled: false }, // Pulse without white bands, 10% slower
  { kind: 'video', style: 'pulseCalm', enabled: false }, // Pulse Soft, calmer and slower, fewer white specks
  { kind: 'video', style: 'pulseCalmFadeSlow', enabled: true }, // pulseCalm at half speed, eased down at the end
];
const RESULTS = ALL_RESULTS.filter(r => r.enabled);
// Used only if this browser can't make video and no photo result is enabled.
const PHOTO_FALLBACK = ALL_RESULTS.find(r => r.style === 'digital');
const MIN_GENERATION_MS = 3000; // photos render fast; let the loading screen play for a moment
let lastResult = null;

function pickResult() {
  let options = RESULTS.filter(r => r.kind === 'photo' || window.GlitchVideo.supported());
  if (!options.length) options = [PHOTO_FALLBACK];
  if (options.length > 1) options = options.filter(r => r !== lastResult);
  lastResult = options[Math.floor(Math.random() * options.length)];
  return lastResult;
}

// Returns { blob, type, poster }. onProgress(0..1) drives the loading screen.
async function generateArt(photoDataUrl, onProgress = () => {}) {
  const started = performance.now();
  onProgress(0.04);
  creepTo(0.3);
  // Phones and tablets run out of memory (iOS reloads the page, the Android WebView force closes the app)
  // when segmentation and the video render overlap the full-screen storm, so the work waits for it.
  await wait(LOADING_VARIANT === 'storm' ? window.LoadingFx.SCREEN_MS : 80);
  const [photo, glitch] = await Promise.all([loadImage(photoDataUrl), loadImage('assets/glitch.webp')]);
  const result = pickResult();
  let art;
  if (result.kind === 'video') {
    const { blob, mimeType, poster } = await window.GlitchVideo.render(photo, glitch, {
      style: result.style,
      onProgress: p => { stopCreep(); onProgress(0.3 + 0.65 * p); },
    });
    art = { blob, type: mimeType.split(';')[0], poster };
  } else {
    const still = await window.GlitchArt.render(photo, glitch, { width: OUTPUT_W, height: OUTPUT_H, style: result.style });
    art = { blob: await (await fetch(still)).blob(), type: 'image/jpeg', poster: still };
    onProgress(0.6);
  }
  creepTo(0.97);
  await wait(MIN_GENERATION_MS - (performance.now() - started));
  return art;
}

// ---------- result ----------
let artUrl = null;

function showResult() {
  const { blob, type, poster } = state.art;
  const isVideo = type.startsWith('video/');
  if (artUrl) URL.revokeObjectURL(artUrl);
  artUrl = URL.createObjectURL(blob);

  const videoEl = $('#resultVideo'), imageEl = $('#resultImage');
  const art = isVideo ? videoEl : imageEl;
  clearResult();
  art.hidden = false;
  if (isVideo) {
    art.poster = poster;
    art.onloadeddata = () => art.classList.add('is-loaded');
  } else {
    art.onload = () => art.classList.add('is-loaded');
  }
  art.src = artUrl;

  startPublish();
  go('result');
}

// ---------- upload + QR ----------
// Each result gets one upload; a newer result (or going home) makes older uploads ignore their answer.
let publishRun = 0;
const resultHint = $('#resultHint');
const RESULT_HINT_HTML = resultHint.innerHTML;

function startPublish() {
  const run = ++publishRun;
  const qr = $('#resultQr');
  const { blob, type } = state.art;
  qr.innerHTML = '<span class="result-step__qr-loader" aria-label="Uploading"></span>';
  resultHint.innerHTML = 'Preparing<br>your QR code…';
  // No countdown while the QR code is loading: the visitor gets the full time once it's up.
  stopResultTimer();
  resultTimerEl.style.visibility = 'hidden'; // keeps its space, so the layout doesn't jump
  publishArt(blob, type)
    .then(url => {
      if (run !== publishRun) return;
      renderQr(qr, url);
      resultHint.innerHTML = RESULT_HINT_HTML;
      startResultTimer();
    })
    .catch(err => {
      if (run !== publishRun) return;
      console.warn('Upload failed', err);
      qr.innerHTML = '<button class="result-step__retry" type="button" data-action="retry-upload">Retry</button>';
      resultHint.innerHTML = 'Upload failed<br>check the internet';
      startResultTimer(); // so an unattended kiosk still finds its way home
    });
}

function retryUpload() {
  if (state.step !== 'result' || !state.art) return;
  startPublish();
}

// Submits the art to the engagement API and returns the download page URL for the QR code.
async function publishArt(blob, type) {
  const cfg = window.APP_CONFIG;
  const body = new FormData();
  body.append('externalUserId', randomUserId());
  body.append('file', blob, `curious-art-${Date.now()}.${extension(type)}`);

  const res = await fetch(`${cfg.engagementBaseUrl}/v1/submissions`, {
    method: 'POST',
    body,
    headers: {
      'x-app-key': cfg.appKey,
      'x-app-secret': cfg.appSecret,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(cfg.uploadTimeoutMs),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status}) ${json?.message || ''}`.trim());
  const qrId = json?.data?.qrId;
  if (!qrId) throw new Error('Invalid upload response');
  return `${cfg.downloadBaseUrl}/${encodeURIComponent(qrId)}`;
}

function randomUserId() {
  const rand = crypto.randomUUID
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  return `curious-${rand}`;
}

// The result screen goes back to home by itself after 90 seconds, counting down on screen.
const RESULT_TIMEOUT_S = 90;
const resultTimerEl = $('#resultTimer');
let resultTimer = null;

function startResultTimer() {
  stopResultTimer();
  let left = RESULT_TIMEOUT_S;
  const show = () => { resultTimerEl.textContent = `Back to home in ${left}s`; };
  show();
  resultTimerEl.style.visibility = '';
  resultTimer = setInterval(() => {
    left--;
    if (left <= 0) { stopResultTimer(); home(); return; }
    show();
  }, 1000);
}

function stopResultTimer() {
  clearInterval(resultTimer);
  resultTimer = null;
}

function clearResult() {
  for (const el of [$('#resultVideo'), $('#resultImage')]) {
    el.hidden = true;
    el.classList.remove('is-loaded');
    el.removeAttribute('src');
  }
}

function extension(type) {
  return { 'video/mp4': 'mp4', 'video/webm': 'webm', 'image/jpeg': 'jpg' }[type] || 'bin';
}

function renderQr(el, text) {
  if (typeof qrcode !== 'function') { el.textContent = ''; return; }
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  el.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
}

// ---------- helpers ----------
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function setButtonLabel(btn, text) { btn.querySelector('.btn__content').textContent = text; }

// ---------- wiring ----------
const actions = {
  'start': () => go('camera'),
  'open-terms': openTerms,
  'close-terms': closeTerms,
  'confirm-terms': closeTerms,
  'capture': capture,
  'upload': openUpload,
  'retake': () => go('camera'),
  'submit': submit,
  'home': home,
  'try-again': home,
  'retry-upload': retryUpload,
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action]();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeTerms(); });

window.addEventListener('load', () => {
  setTimeout(() => $('#loader').classList.add('is-hidden'), 600);
  window.GlitchArt.preload();
  window.GlitchVideo.preload().catch(err => console.warn('MP4 muxer unavailable, will use MediaRecorder', err));
});

go('welcome');
