# MediaSession (lock-screen / notification controls)

OS media UI (Android notification + lock screen, desktop media keys) driven by the W3C **MediaSession API** — hardware/lock-screen play-pause-next-prev + "now playing" card. Honoured by the Android WebView, so it covers the Android app's media controls with no native code (foreground service in `pwa_capacitor_android.md` keeps audio *alive*; MediaSession provides *controls + metadata*).

## Design

Standalone, dependency-free module: `web/composables/useMediaSession.ts` → `createMediaSession(controls)`. Takes plain getter/action callbacks (no Vue/Nuxt/`$fetch`) — unit-testable in isolation (`web/test/unit/composables/useMediaSession.test.ts`). Store wires it up.

```
createMediaSession(controls) → {
  setMetadata(meta | null)        // title/artist/album/artwork → MediaMetadata
  setPlaybackState('playing'|'paused'|'none')
  updatePosition()                // setPositionState, throttled ~1/s
  resetPositionThrottle()         // call on track change
  registerHandlers()              // play/pause/next/prev/seek action handlers
}
```

`controls`: `isPlaying`/`currentTime`/`duration` getters + `play`/`pause`/`next`/`previous`/`seek` actions, backed by the player store.

## Where the store hooks in (`web/stores/player.ts`)

- `createMediaSession({...})` near the top, getters→refs, actions→`togglePlay`/`next`/`previous`/`seek`.
- `getAudio()` `timeupdate` → `media.updatePosition()`.
- `getAudio()` registers handlers once → `registerHandlers()`; `error` → `setPlaybackState('paused')`.
- `playTrack()` → `setMetadata(trackMeta(track))`, `resetPositionThrottle()`, `setPlaybackState(...)`.
- `togglePlay()`/`dismiss()` → `setPlaybackState(...)`.
- localStorage restore path → `setMetadata(...)` + `setPlaybackState('paused')` so a restored track shows correctly before playback starts.

Lock-screen next/prev call the store's `next()`/`previous()` — all 5 shuffle modes (incl. `catalogue`/`explorer`) work from the lock screen for free.

## Gotchas

- **Artwork must be an absolute URL** — local artwork resolves relative `/img/...`, OS layer needs absolute. `toAbsoluteUrl()` prefixes `location.origin`, leaves already-absolute S3 URLs alone.
- **`setPositionState` throws** if `position > duration` during the metadata-load race — wrapped in try/catch, skipped when `duration<=0` or `position>duration`.
- **Throttle** position updates ~1/s (`timeupdate` fires ~4×/s).
- **Availability guard:** every call checks `'mediaSession' in navigator` — SSR and old WebViews safe.
