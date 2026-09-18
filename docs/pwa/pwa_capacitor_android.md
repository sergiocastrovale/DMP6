# Capacitor Android wrapper

Android app = thin Capacitor shell loading the **live remote app** in its WebView. Does not bundle the Nuxt build.

## Layout (`mobile/`)

Sibling of `web/`, kept out of the Nuxt Docker/deploy pipeline:

- `capacitor.config.ts` — `appId`/`appName`; `server.url` from `MOBILE_SERVER_URL` env (baked at build time), `cleartext` auto-enabled only for `http://` origin (CI emulator).
- `package.json` — Capacitor core/cli/android + `@capacitor/app`/`status-bar`/`splash-screen`; scripts: `add:android`, `apply-overrides`, `sync`, `build:debug`, `build:release`.
- `www/index.html` — offline fallback, shown only if origin unreachable.
- `android-overrides/` — native sources injected after the Android project is generated: `PlaybackService.java` (foreground service, ongoing media notification), `ForegroundServicePlugin.java` (exposes `start({title})`/`stop()` to JS), `MainActivity.java` (registers the plugin), `androidTest/ForegroundServiceTest.java` (background-audio gate, `pwa_testing.md`). All use a `__PACKAGE__` placeholder, replaced with the real applicationId on apply.
- `scripts/apply-android-overrides.mjs` — copies overrides into generated `android/`, patches `AndroidManifest.xml` (permissions + `<service>`), adds the uiautomator test dep. Idempotent.
- `android/` generated (gitignored), not committed.

## Build flow

`npx cap add android` generates the project → `apply-android-overrides.mjs` injects native pieces → Gradle assembles the APK. Automated by `.github/workflows/android-build.yml` (one run per origin variant, `pwa_networking.md`). Builds on Linux/CI, no Mac needed.

Release signing: create a keystore, add a signing config, run `build:release`. Self-signed sideload fine for personal multi-device use. Icons/splash via `@capacitor/assets` from the same source art as the PWA icons.

## Auth in the WebView

Login sets `dmp_session` as a first-party persistent cookie (7d) for the origin host — WebView persists it across launches, log in once, stays logged in ~7 days. No native auth code. Requires `NODE_ENV=production` server-side for the cookie's `Secure` flag over HTTPS.

## Background audio

HTML5 `<audio>` in a backgrounded WebView is killed by Android unless a **foreground service** holds an ongoing media notification.

- Web bundle calls the service via `useNativeBridge.ts` — guarded, no-ops in a plain browser, calls `window.Capacitor.Plugins.ForegroundService` inside the WebView. Player store starts it on playback, stops on dismiss.
- `ForegroundServicePlugin` → `PlaybackService` runs `startForeground` type `mediaPlayback`. Manifest permissions (apply-script-added): `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK` (Android 14+), `POST_NOTIFICATIONS`.
- Media controls + metadata come from the WebView MediaSession (`pwa_mediasession.md`) — the service only keeps audio alive.
- OEM battery killers (Xiaomi/Samsung) may still need "don't optimize" toggled by the user.

### Backgrounded-fetch gotcha
Backgrounded JS `$fetch` throttles, so `catalogue`/`explorer` next-track fetches can stall/gap. Mitigated by the player's existing `catalogueBuffer` prefetch (`stores/player.ts`).
