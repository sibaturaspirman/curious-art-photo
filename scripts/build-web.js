// Copies the web app into www/, used by Capacitor (the APK) and by Vercel. The dev server stays out.
// sw.js and frame.html are only used in a browser; the APK skips them.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const FILES = [
  'index.html', 'frame.html', 'sw.js', 'styles.css', 'manifest.json', 'config.js',
  'app.js', 'glitch.js', 'glitch-video.js', 'outline.js', 'loading.js', 'bg-glitch.js',
];
const DIRS = ['assets', 'fonts'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const file of FILES) fs.copyFileSync(path.join(ROOT, file), path.join(OUT, file));
for (const dir of DIRS) fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
console.log(`Web app copied to ${path.relative(ROOT, OUT)}/`);
