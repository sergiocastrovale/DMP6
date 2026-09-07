# Capacitor Android wrapper

The Android app is a thin Capacitor shell that loads the **live remote app** in its WebView. It
does not bundle the Nuxt build.

## Layout (`mobile/`)

Top-level `mobile/` directory (sibling of `web/`, kept out of the Nuxt Docker/deploy pipeline):

- `capacitor.config.ts` — `appId`/`appName`; `server.url` comes from the `MOBILE_SERVER_URL` env
  var (baked at build time), `cleartext` auto-enabled only for an `http://` origin (CI emulator).
- `package.json` — Capacitor core/cli/android + `@capacitor/app`, `status-bar`, `splash-screen`;
  scripts: `add:android`, `apply-overrides`, `sync`, `build:debug`, `build:release`.
- `www/index.html` — offline fallback shown only if the origin is unreachable.
- `android-overrides/` — native sources injected after the Android project is generated:
  - `PlaybackService.java` — foreground service posting an ongoing media notification.
  - `ForegroundServicePlugin.java` — Capacitor plugin exposing `start({title})`/`stop()` to JS.
  - `MainActivity.java` — registers the plugin.
  - `androidTest/ForegroundServiceTest.java` — the background-audio gate (see pwa_testing.md).
  - All use a `__PACKAGE__` placeholder, replaced with the real applicationId on apply.
- `scripts/apply-android-overrides.mjs` — copies the overrides into the generated `android/`,
  patches `AndroidManifest.xml` (permissions + `<service>`), and adds the uiautomator test dep.
  Idempotent.
- `android/` is generated (gitignored), not committed.

## Build flow

`npx cap add android` generates the project, then `node scripts/apply-android-overrides.mjs`
injects the native pieces, then Gradle assembles the APK. Automated by
`.github/workflows/android-build.yml` (one run per origin variant — see
[pwa_networking.md](./pwa_networking.md)). Android builds on Linux/CI; no Mac needed.

Release signing: create a keystore, add a signing config, run `build:release`. Self-signed
sideload is fine for personal multi-device use. Icons/splash via `@capacitor/assets` from the
same source art as the PWA icons.

## Auth in the WebView

Login sets `dmp_session` as a first-party persistent cookie (7d) for the origin host. The Android
WebView persists it across launches → log in once, stays logged in ~7 days. No native auth code.
Requires `NODE_ENV=production` on the server so the cookie gets `Secure` over HTTPS.

## Background audio

HTML5 `<audio>` in a backgrounded WebView is killed by Android unless a **foreground service**
holds an ongoing media notification.

- The web bundle calls the service via `web/composables/useNativeBridge.ts` — a guarded bridge
  that no-ops in a plain browser and, inside the WebView, calls
  `window.Capacitor.Plugins.ForegroundService`. The player store starts it on playback and stops
  it on dismiss.
- `ForegroundServicePlugin` → `PlaybackService` runs `startForeground` with type
  `mediaPlayback`. Manifest permissions (added by the apply script): `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (Android 14+), `POST_NOTIFICATIONS`.
- The media controls + metadata themselves come from the WebView MediaSession (see
  [pwa_mediasession.md](./pwa_mediasession.md)); the service only keeps audio alive.
- OEM battery killers (Xiaomi/Samsung) may still need "don't optimize" toggled by the user.

### Backgrounded-fetch gotcha
When backgrounded, JS `$fetch` is throttled, so `catalogue`/`explorer` next-track fetches can
stall and gap. Mitigation: the player already prefetches via `catalogueBuffer` in
`web/stores/player.ts`.
