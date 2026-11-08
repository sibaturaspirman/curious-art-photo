// Copies the web app into www/ for Capacitor (the APK). Server-only and dev-only files stay out.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const FILES = [
  'index.html', 'styles.css', 'manifest.json', 'config.js',
  'app.js', 'glitch.js', 'glitch-video.js', 'outline.js', 'loading.js', 'bg-glitch.js',
];
const DIRS = ['assets', 'fonts'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const file of FILES) fs.copyFileSync(path.join(ROOT, file), path.join(OUT, file));
for (const dir of DIRS) fs.cpSync(path.join(ROOT, dir), path.join(OUT, dir), { recursive: true });
console.log(`Web app copied to ${path.relative(ROOT, OUT)}/`);
