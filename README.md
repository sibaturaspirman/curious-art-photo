# Curious Art Photo (IQOS kiosk)

Welcome → camera → preview → result (glitch art) → QR to the download page on `download.agrvty.net`.

Runs as an Android app (APK, via Capacitor) or in a browser.

## Upload

The app uploads each result straight from the frontend to the engagement API. No server of our own is needed.

- `POST {engagementBaseUrl}/v1/submissions`, multipart `externalUserId` (random) and `file`
- Headers `x-app-key`, `x-app-secret`, `Accept: application/json`
- The QR points at `{downloadBaseUrl}/{data.qrId}`, e.g. `https://download.agrvty.net/ZXnxUCjT`
- If the upload fails (no internet), the QR box shows **Retry**

Settings live in `config.js`. The key ships inside the app, so it should only be allowed to submit to this engagement, and should be rotated after the event.

## Android app (APK)

Android Studio is not needed. The build uses these, kept in `~/Android`:

- `jdk-21`: Amazon Corretto 21
- `sdk`: Android command-line tools, plus `platform-tools`, `platforms;android-36`, `build-tools;36.0.0`
- `gradle-8.14.3`: Gradle (the wrapper downloads from GitHub, which can be unreliable)

```bash
npm install
npm run android:apk    # → android/app/build/outputs/apk/debug/app-v0.1.apk
```

The version is `appVersion` at the top of `android/app/build.gradle`. For a new release, bump it (e.g. `0.2`) and `appVersionCode` (e.g. `2`), or the tablet won't install it over the old one.

Install on a tablet: copy the APK over and open it (allow "install unknown apps"), or with USB debugging
`~/Android/sdk/platform-tools/adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.

`npm run android:open` opens the project in Android Studio instead, if it is installed.

After changing any web file, run `npm run android:sync` before building again.

The app is locked to portrait, keeps the screen on, and hides the system bars. It asks for camera permission on first use.

## Vercel

`vercel.json` deploys it as a static site: `npm run build:web` copies the web app into `www/`, which is served as is. `server.js` is excluded (`.vercelignore`), so Vercel does not try to run it as a function.

## Browser (testing)

```bash
npm install
npm start
```

- On this computer: http://localhost:5191
- On a tablet (same Wi-Fi): the `https://<ip>:5192` address the server prints. HTTPS is required for the camera. To trust the certificate, open `http://<ip>:5191/cert.html` on the tablet once.

`server.js` only serves files; it is not part of the APK.

MediaPipe, its models, the MP4 muxer and the QR library are in `assets/vendor`, so the app itself works offline. Only the upload needs internet.

## Results

| Kind  | Style      | Code |
|-------|------------|------|
| Photo | `overlay`  | `glitch.js` |
| Photo | `digital`  | `glitch.js` |
| Photo | `slice`    | `glitch.js` |
| Video | `halfface` | `glitch-video.js` |
| Video | `pulse`    | `glitch-video.js` |

`RESULTS` in `app.js` controls which ones are picked. Videos are 6 s, 720×960 MP4, encoded frame by frame
(WebCodecs), so slow tablets give the same quality, just a little later.

## Tablet checklist

- Android with an up-to-date Android System WebView / Chrome (94 or newer, for frame-by-frame video encoding).
- Internet connection for uploading and the QR code.
- Allow the camera when the app asks.
