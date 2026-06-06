# MediaSession (lock-screen / notification controls)

The OS media UI (Android notification + lock screen, desktop media keys) is driven by the
W3C **MediaSession API**. This is what makes hardware/lock-screen play-pause-next-prev and the
"now playing" card work, and it is honoured by the Android WebView — so it covers the Android
app's media controls without native code (the foreground service in
[pwa_capacitor_android.md](./pwa_capacitor_android.md) keeps the audio *alive*; MediaSession
provides the *controls + metadata*).

## Design

The logic lives in a standalone, dependency-free module:
`web/composables/useMediaSession.ts` → `createMediaSession(controls)`.

It takes plain getter/action callbacks (no Vue, no Nuxt, no `$fetch`), so it is unit-testable in
isolation (`web/test/useMediaSession.test.ts`). The store wires it up.

```
createMediaSession(controls) → {
  setMetadata(meta | null)        // title/artist/album/artwork → MediaMetadata
  setPlaybackState('playing'|'paused'|'none')
  updatePosition()                // setPositionState, throttled ~1/s
  resetPositionThrottle()         // call on track change
  registerHandlers()              // play/pause/next/prev/seek action handlers
}
```

`controls` exposes `isPlaying/currentTime/duration` getters and `play/pause/next/previous/seek`
actions, all backed by the player store.

## Where the store hooks in (`web/stores/player.ts`)

- `const media = createMediaSession({ ... })` near the top, wiring getters to refs and actions to
  the store's `togglePlay/next/previous/seek`.
- `getAudio()` `timeupdate` listener → `media.updatePosition()`.
- `getAudio()` registers handlers once → `media.registerHandlers()`; `error` → `setPlaybackState('paused')`.
- `playTrack()` → `media.setMetadata(trackMeta(track))`, `resetPositionThrottle()`, and
  `setPlaybackState('playing'|'paused')`.
- `togglePlay()` / `dismiss()` → `setPlaybackState(...)`.
- localStorage restore path → `setMetadata(...)` + `setPlaybackState('paused')` so a restored
  track shows correctly before playback starts.

Because lock-screen next/prev call the store's `next()`/`previous()`, all 5 shuffle modes
(including `catalogue` and `explorer`) work from the lock screen for free.

## Gotchas baked into the module

- **Artwork must be an absolute URL.** Local artwork resolves to a relative `/img/...` path; the
  OS media layer needs an absolute URL. `toAbsoluteUrl()` prefixes `location.origin` for relative
  paths and leaves S3 URLs (already absolute) alone.
- **`setPositionState` throws** if `position > duration` during the metadata-load race — wrapped
  in try/catch and skipped when `duration <= 0` or `position > duration`.
- **Throttle** position updates to ~1/s (the `timeupdate` event fires ~4×/s).
- **Availability guard:** every call checks `'mediaSession' in navigator`, so SSR and old WebViews
  are safe.
