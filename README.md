# Curious Art Photo (IQOS kiosk)

Welcome → camera → preview → result (glitch art) → QR to the download page on `download.grvty.id`.

Runs as an Android app (APK, via Capacitor) or in a browser.

## Upload

The app uploads each result straight from the frontend to the engagement API. No server of our own is needed.

- `POST {engagementBaseUrl}/v1/submissions`, multipart `externalUserId` (random) and `file`
- Headers `x-app-key`, `x-app-secret`, `Accept: application/json`
- The QR points at `{downloadBaseUrl}/{data.id}`, e.g. `https://download.grvty.id/9`
- If the upload fails (no internet), the QR box shows **Retry**

Settings live in `config.js`. The key ships inside the app, so it should only be allowed to submit to this engagement, and should be rotated after the event.

## Android app (APK)

Needs [Android Studio](https://developer.android.com/studio), which includes the Android SDK and Java.

```bash
npm install
npm run android:open   # copies the web app to www/, syncs it to android/, opens Android Studio
```

In Android Studio, use **Build → Build App Bundle(s) / APK(s) → Build APK(s)**, or run on a connected tablet. From the command line, `npm run android:apk` builds `android/app/build/outputs/apk/debug/app-debug.apk`.

After changing any web file, run `npm run android:sync` before building again.

The app is locked to portrait, keeps the screen on, and hides the system bars. It asks for camera permission on first use.

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
