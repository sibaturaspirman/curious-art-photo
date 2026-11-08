// Dev / browser server for Curious Art Photo. The Android app (Capacitor) does not use it.
//   - Serves the app over HTTP (this computer: http://localhost:5191) and HTTPS (tablets and phones on
//     the same Wi-Fi: https://<this computer's IP>:5192). Browsers only allow the camera on HTTPS or
//     localhost, so tablets must use the HTTPS address.
//   - Uploads go straight from the app to the engagement API (see config.js); this server only serves
//     files.
// Usage: node server.js   (env: PORT, HTTPS_PORT)
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const CERTS = path.join(ROOT, '.certs');
const PORT = Number(process.env.PORT) || 5191;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || 5192;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json','.wasm': 'application/wasm', '.tflite': 'application/octet-stream',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const PRIVATE = new Set(['node_modules', 'uploads', '.certs', '.claude', 'output', 'android', 'www', 'scripts']);

// ---------- static files ----------
function serveStatic(res, urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath).replace(/^\/+/, '');
  const top = rel.split('/')[0];
  if (PRIVATE.has(top) || rel.split('/').some(part => part.startsWith('.'))) return send(res, 404, 'not found');
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 404, 'not found');
  fs.stat(file, (err, st) => (err || !st.isFile() ? send(res, 404, 'not found') : serveFile(res, file)));
}

function serveFile(res, file, headers = {}) {
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', ...headers });
  fs.createReadStream(file).pipe(res);
}

function send(res, status, text) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}


function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  if (url.pathname === '/kiosk-ca.crt') return serveCa(res);
  serveStatic(res, url.pathname);
}

// ---------- HTTPS certificate ----------
function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

// A small local certificate authority (made once, kept in .certs/ca*.pem) signs the HTTPS certificate.
// Install the CA on a tablet once (open http://<this computer's IP>:5191/cert.html there) and Chrome
// trusts the kiosk: no warning, and the service worker (PWA offline cache) can register. The server
// certificate is re-signed whenever this computer's LAN addresses change; the CA stays the same, so
// tablets don't need to install it again.
// (The old self-signed key.pem / cert.pem / ips.json are no longer used.)
const CA_KEY = path.join(CERTS, 'ca-key.pem'), CA_CERT = path.join(CERTS, 'ca.pem');

function localCa(forge) {
  try {
    return {
      key: forge.pki.privateKeyFromPem(fs.readFileSync(CA_KEY, 'utf8')),
      cert: forge.pki.certificateFromPem(fs.readFileSync(CA_CERT, 'utf8')),
    };
  } catch (err) { /* make a new one */ }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 10 * 365 * 24 * 3600 * 1000);
  const subject = [{ name: 'commonName', value: 'Curious Art Photo Kiosk CA' }, { name: 'organizationName', value: 'Curious Art Photo kiosk' }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  fs.mkdirSync(CERTS, { recursive: true });
  fs.writeFileSync(CA_KEY, forge.pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(CA_CERT, forge.pki.certificateToPem(cert));
  return { key: keys.privateKey, cert };
}

function certificate() {
  const forge = require('node-forge'); // installed with selfsigned
  const ips = lanAddresses();
  const keyFile = path.join(CERTS, 'server-key.pem'), certFile = path.join(CERTS, 'server-cert.pem'), ipsFile = path.join(CERTS, 'server-ips.json');
  const ca = localCa(forge);
  const caPem = forge.pki.certificateToPem(ca.cert);
  try {
    if (fs.readFileSync(ipsFile, 'utf8') === JSON.stringify(ips)) {
      const leaf = forge.pki.certificateFromPem(fs.readFileSync(certFile, 'utf8'));
      if (leaf.issuer.hash === ca.cert.subject.hash && ca.cert.verify(leaf)) {
        return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile, 'utf8') + caPem };
      }
    }
  } catch (err) { /* make a new one */ }
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '02' + crypto.randomBytes(8).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 825 * 24 * 3600 * 1000);
  cert.setSubject([{ name: 'commonName', value: 'Curious Art Photo kiosk' }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...ips.map(ip => ({ type: 7, ip }))] },
    { name: 'subjectKeyIdentifier' },
    { name: 'authorityKeyIdentifier', keyIdentifier: ca.cert.generateSubjectKeyIdentifier().getBytes() },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());
  const certPem = forge.pki.certificateToPem(cert);
  fs.writeFileSync(keyFile, forge.pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(certFile, certPem);
  fs.writeFileSync(ipsFile, JSON.stringify(ips));
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: certPem + caPem };
}

// GET /kiosk-ca.crt: the CA certificate (public part only) for tablets to install.
function serveCa(res) {
  fs.readFile(CA_CERT, (err, pem) => {
    if (err) return send(res, 404, 'not found');
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="curious-art-kiosk-ca.crt"',
      'Cache-Control': 'no-store',
    });
    res.end(pem);
  });
}

http.createServer(handle).listen(PORT, () => {
  console.log(`Curious Art Photo on http://localhost:${PORT}`);
});
https.createServer(certificate(), handle).listen(HTTPS_PORT, () => {
  console.log('For tablets and phones on the same Wi-Fi:');
  for (const ip of lanAddresses()) console.log(`  https://${ip}:${HTTPS_PORT}`);
  console.log('To trust the kiosk on a tablet (no warning, PWA works offline), open there once:');
  for (const ip of lanAddresses()) console.log(`  http://${ip}:${PORT}/cert.html`);
});
