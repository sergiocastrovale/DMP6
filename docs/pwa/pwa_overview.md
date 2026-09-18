# PWA + Android app — overview

DMP is also a phone app. **No separate codebase** — the existing Nuxt 4 SSR app is made installable (PWA) and wrapped in a thin **Capacitor Android** shell whose WebView loads the live app over the network. Same backend, `.env`, DB, API, UI.

## Why not Tauri/Rust

No local DB/compute on the phone — audio streams from the NAS. Tauri mobile would still wrap the same Nuxt WebView, immature on Android, separate build pipeline. Wrong tool.

## Scope

- **Android first** — iOS deferred (below).
- **Test-first** — maintainer can't manually test on devices; audio + background behavior gated by automated CI tests (`pwa_testing.md`).

## The one key insight

The Capacitor WebView loads the **remote HTTPS origin** directly (Tailscale `ts.net` or Cloudflare Tunnel domain). WebView's document origin *is* that host:
- every existing **relative** URL works unchanged (`/api/audio/{id}`, `/img/...`, `$fetch('/api/...')`)
- `dmp_session` cookie is **first-party** — no CORS, no API base-URL refactor, no token bridging
- SSR, auth (`server/middleware/auth.ts`), DB access unchanged

Why Capacitor `server.url` instead of bundling/exporting a static SPA.

## Pieces

| Piece | Where | Doc |
|-------|-------|-----|
| Installable PWA (manifest + service worker) | `web/nuxt.config.ts`, `web/public/pwa-*.png` | `pwa_serviceworker.md` |
| Lock-screen / background media controls | `web/composables/useMediaSession.ts`, `web/stores/player.ts` | `pwa_mediasession.md` |
| Android native shell + foreground service | `mobile/` (Capacitor) | `pwa_capacitor_android.md` |
| Reaching the backend over HTTPS | Tailscale / Cloudflare Tunnel | `pwa_networking.md` |
| Automated tests (the gate) | `web/test/`, `.github/workflows/` | `pwa_testing.md` |

## Status

All phases implemented: PWA foundation, MediaSession integration + unit tests, Capacitor Android wrapper, Android foreground service (background audio) + native bridge, Vitest + Playwright E2E + Android emulator gate on CI, Android build/sign workflow (per-origin APK variants). CI-only items (Playwright e2e, emulator gate, APK builds) need Postgres/KVM emulator/Android SDK — not run in local dev.

## iOS, later

Needs a Mac + Xcode: `mobile/ios` target, `Info.plist` `UIBackgroundModes: audio`, native `AVAudioSession .playback` + `MPRemoteCommandCenter`/`MPNowPlayingInfoCenter` plugin (WebKit's JS-MediaSession→lock-screen bridge is unreliable). Phases 1-3 reused unchanged. iOS background audio isn't faithfully testable in Simulator — needs a real-device cloud farm, main reason it's deferred.
