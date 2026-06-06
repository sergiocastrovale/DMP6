# PWA / Android testing

The maintainer cannot manually test on devices, so audio + background behaviour is gated by
**automated tests**. Everything runs on free GitHub Actions runners (Linux for web + Android
emulator).

## Test pyramid

| Layer | Tool | Where | Status |
|-------|------|-------|--------|
| 5a Unit | Vitest (happy-dom) | `web/test/useMediaSession.test.ts` | ✅ MediaSession controller (13 tests) |
| 5b API | Vitest (pure helper) | `web/test/audioRange.test.ts` | ✅ Range/ETag/MIME (10 tests) |
| 5c Web E2E | Playwright | `web/e2e/` | ✅ PWA install, SW denylist, audio Range/304/401 |
| 5d Android E2E | Emulator (UIAutomator) | `mobile/android-overrides/androidTest/` | ✅ foreground-service gate |

Run on CI via `.github/workflows/web-tests.yml` (5a/5b/5c) and `android-e2e.yml` (5d).

## 5a — Unit (implemented)

```bash
cd web && pnpm test          # vitest run
```

`web/test/useMediaSession.test.ts` covers the lock-screen/notification logic that cannot be
hand-verified: metadata building (incl. relative→absolute artwork), action-handler registration
and routing (`next`/`prev`/`play`/`pause`/`seek` with clamping), `playbackState`, and throttled
`setPositionState` with its error-swallowing race guard. 13 tests.

The logic was deliberately extracted into `web/composables/useMediaSession.ts` (plain module,
injected callbacks) so it needs no Nuxt runtime, `$fetch`, or DOM-of-a-real-store to test.

## 5b — API contract (implemented)

The Range/ETag/MIME logic was extracted from `web/server/api/audio/[id].get.ts` into the pure
helper `web/server/utils/audioRange.ts`, unit-tested in `web/test/audioRange.test.ts`: open/closed
/suffix Range parsing, end clamping, unsatisfiable → null (200 fallback), MIME mapping, ETag
format. The HTTP status paths (`206`/`304`/`401`) are exercised end-to-end in 5c.

## 5c — Web / PWA E2E (implemented)

Playwright (headless Chromium), `web/e2e/`, against the production build (`pnpm build` → the SW
only exists there). `global-setup.ts` logs in once and reuses the cookie session.

- `pwa.spec.ts`: manifest served with the right fields; service worker registers and controls the
  page; **SW denylist guard** — after exercising an `/api` call, assert via `caches` that **no
  `/api/*` response is cached**.
- `audio.spec.ts`: `Range` → `206` + `Content-Range`; matching `If-None-Match` → `304`;
  unauthenticated → `401`. The 206/304 specs `test.skip` when no tracks are seeded (CI has no
  music files), so they pass cleanly and run fully when data is present.

Lighthouse's PWA category was removed in Lighthouse 12, so installability is asserted directly via
the manifest + service-worker specs instead.

## 5d — Android E2E (implemented, the background-audio gate)

`.github/workflows/android-e2e.yml` boots a real emulator (`reactivecircus/android-emulator-runner`,
API 30) and runs `mobile/android-overrides/androidTest/ForegroundServiceTest.java`:

1. start `PlaybackService` (foreground service)
2. assert its media notification is posted
3. **`UiDevice.pressHome()` (real backgrounding)** → assert the notification/service is still alive
4. stop → assert it clears

This validates the custom keep-alive mechanism — the risky native bit. The audio element +
MediaSession are covered by the web unit/e2e tests; automating a play-tap inside the WebView is
out of scope.

### Honest limitation
CI backgrounds via home-press (real backgrounding + FG-service path), not a physical screen
*lock*. True lock behaviour across OEMs is accepted as best-effort, unverified residual risk.

## CI wiring

`.github/workflows/web-tests.yml` runs unit + typecheck (job `unit`) and Playwright against a
Postgres service + seeded DB (job `e2e`). `android-e2e.yml` runs the emulator gate.
`android-build.yml` builds installable APKs per origin variant.
