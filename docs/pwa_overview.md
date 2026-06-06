# PWA + Android app — overview

DMP is also a phone app. There is **no separate codebase**: the existing Nuxt 4 SSR app is made
installable (PWA) and wrapped in a thin **Capacitor Android** shell whose WebView loads the live
app over the network. Same backend, same `.env`, same DB, same API, same UI.

## Why not Tauri/Rust

Rust on the phone buys nothing here — there is no local DB or local compute; audio streams from
the NAS. Tauri mobile would still wrap the same Nuxt WebView, but immature on Android with a
separate build pipeline. Wrong tool.

## Scope

- **Android first.** iOS is deferred (see "iOS, later" below).
- **Test-first**, because the maintainer cannot manually test on devices. Audio + background
  behaviour is gated by automated tests on CI. See [pwa_testing.md](./pwa_testing.md).

## The one key insight

The Capacitor WebView loads the **remote HTTPS origin** directly (Tailscale `ts.net` or the
Cloudflare Tunnel domain). The WebView's document origin therefore *is* that host, so:

- every existing **relative** URL works unchanged (`/api/audio/{id}`, `/img/...`, `$fetch('/api/...')`)
- the `dmp_session` cookie is **first-party** → no CORS, no API base-URL refactor, no token bridging
- SSR, auth (`server/middleware/auth.ts`), and DB access stay exactly as they are

This is why we use Capacitor `server.url` instead of bundling/exporting a static SPA.

## Pieces

| Piece | Where | Doc |
|-------|-------|-----|
| Installable PWA (manifest + service worker) | `web/nuxt.config.ts`, `web/public/pwa-*.png` | [pwa_serviceworker.md](./pwa_serviceworker.md) |
| Lock-screen / background media controls | `web/composables/useMediaSession.ts`, `web/stores/player.ts` | [pwa_mediasession.md](./pwa_mediasession.md) |
| Android native shell + foreground service | `mobile/` (Capacitor) | [pwa_capacitor_android.md](./pwa_capacitor_android.md) |
| Reaching the backend over HTTPS | Tailscale / Cloudflare Tunnel | [pwa_networking.md](./pwa_networking.md) |
| Automated tests (the gate) | `web/test/`, `.github/workflows/` | [pwa_testing.md](./pwa_testing.md) |

## Status

- [x] Phase 1 — PWA foundation (`@vite-pwa/nuxt`, manifest, SW denylist, icons)
- [x] Phase 2 — MediaSession integration + unit tests
- [x] Phase 3 — Capacitor Android wrapper (`mobile/`)
- [x] Phase 4 — Android foreground service (background audio) + native bridge
- [x] Phase 5 — Vitest + Playwright E2E + Android emulator gate, wired on CI
- [x] Phase 6 — Android build/sign workflow (per-origin APK variants)

All phases implemented. Items that only run on CI / real devices (Playwright e2e, the Android
emulator gate, APK builds) are wired in `.github/workflows/` and require the runner to provide
Postgres / KVM emulator / Android SDK — they are not executed in local dev.

## iOS, later

When picked up: a `mobile/ios` target (needs a Mac + Xcode), `Info.plist`
`UIBackgroundModes: audio`, and a small native `AVAudioSession .playback` +
`MPRemoteCommandCenter`/`MPNowPlayingInfoCenter` plugin (WebKit's JS-MediaSession→lock-screen
bridge is unreliable). Phases 1–3 are reused unchanged. iOS background audio is not faithfully
testable in Simulator, so it needs a real-device cloud farm — which is the main reason it is
deferred.
