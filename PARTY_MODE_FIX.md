# Party Mode Audio Streaming Fix

## Problem

The Party Mode session was not persisting across page navigations, and audio streaming was not working properly. Issues included:

1. **Session state lost on navigation** - Using `useState` didn't work well with complex objects like WebSocket connections
2. **No audio streaming** - Audio capture was only attempted once at session start, not when playback actually started
3. **No visual feedback** - Party button in player didn't show active state
4. **Connection loss** - WebSocket and mediasoup connections were lost on page navigation

## Solution

### 1. Pinia Store with Persistence (`web/stores/partyHost.ts`)

Created a dedicated Pinia store to manage party host state:

- **Reactive state** (persisted in sessionStorage):
  - `isActive`, `sessionId`, `listenerCount`, `inviteUrl`, `error`, `isConnecting`
  
- **Module-level connection objects** (not reactive, not persisted):
  - WebSocket, mediasoup device, transports, producers, audio context, media stream
  
- **Cleanup action** to properly tear down all connections

### 2. Dynamic Audio Producer (`web/composables/usePartyHost.ts`)

Refactored audio capture to be dynamic:

- **`ensureProducer()`** - Creates audio producer on-demand when playback starts
- **Reuses audio context** - Avoids recreating AudioContext if it already exists
- **Watches playback state** - Automatically creates producer when audio starts playing
- **Reconnection logic** - Detects disconnected sessions on mount and reconnects

### 3. Visual Feedback (`web/components/player/AudioPlayer.vue`)

Updated the party button to show active state:

- **Amber color** when party is active
- **Gray color** when inactive
- Uses `usePartyHost()` composable to check session state

### 4. Pinia Persistence Plugin (`web/plugins/pinia-persistence.client.ts`)

Configured `pinia-plugin-persistedstate` to use `sessionStorage` for state persistence across navigation.

## How It Works

### Starting a Session

1. User clicks "Start Session" on `/party` page
2. WebSocket connects to SFU server
3. mediasoup device and transport are created
4. Session state is saved to Pinia store (persisted in sessionStorage)
5. Metadata sync watchers are set up
6. If audio is playing, producer is created immediately
7. If not playing, producer will be created when playback starts

### During Playback

1. When user plays a track, the `isPlaying` watcher triggers
2. `ensureProducer()` is called to create/verify audio producer
3. Audio is captured from the `<audio>` element via Web Audio API
4. Audio track is sent to mediasoup producer
5. Producer streams audio to SFU server
6. Listeners receive the audio stream

### Navigation

1. User navigates to different page (e.g., `/` or `/artists`)
2. Pinia store state persists in sessionStorage
3. Connection objects remain at module level
4. Party button shows active state (amber)
5. Audio continues streaming

### Returning to Page

1. User navigates back to any page
2. Composable checks if session is active on mount
3. If WebSocket is disconnected, automatically reconnects
4. If audio is playing, ensures producer is active
5. Session continues seamlessly

## Key Technical Details

### Why Module-Level Storage?

WebSocket connections, mediasoup devices, and audio contexts cannot be serialized and stored in reactive state. They must be kept as regular JavaScript objects at module scope.

### Why SessionStorage?

Using `sessionStorage` (not `localStorage`) ensures:
- State persists across page navigation within the same tab
- State is cleared when tab/browser is closed
- No stale sessions on next browser launch

### AudioContext Limitation

Once an `AudioContext` creates a `MediaElementSource` from an audio element, it can only be done once. The solution:
- Reuse existing AudioContext and MediaStream if available
- Only create new ones if they don't exist

### Producer Recreation

The mediasoup producer needs to be recreated when:
- Session first starts and audio is playing
- User navigates back and audio is playing
- Audio starts playing after session was started

## Testing

### Local Host Testing

1. **Start session without playing**:
   - Go to `/party`, click "Start Session"
   - Session should show as "Live"
   - Navigate to `/`, party button should be amber
   - Play a track, console should show "Creating new producer"

2. **Start session while playing**:
   - Play a track on `/`
   - Go to `/party`, click "Start Session"
   - Console should show "Creating new producer" immediately

3. **Navigate during session**:
   - Start session, play track
   - Navigate to `/artists`, `/playlists`, etc.
   - Party button should stay amber
   - Return to `/party`, should still show "Live"
   - Console should show "Session active on mount"

4. **Reconnection**:
   - Start session, play track
   - Refresh page (F5)
   - Session should automatically reconnect
   - Console should show "Session active but disconnected, reconnecting..."

### Listener Testing (Live Server or Second Browser)

**Option 1: Using Live Server**
1. Deploy to live server with `PARTY_ROLE=listener`
2. Start local dev server (host mode)
3. Go to `/party` locally, start session, play track
4. Open live server URL in browser
5. Should auto-connect and stream audio

**Option 2: Using Debug Page**
1. Start local dev server
2. Open `http://localhost:3000/party-debug` in a **different browser** (not just a tab)
3. Go to `/party` in first browser, start session, play track
4. Debug page should show:
   - Connection: Connected (green dot)
   - Current track info
   - Playback: Playing
   - Console logs showing audio consumption
5. Click "Toggle Play" to test audio element
6. You should hear the audio streaming

**Important**: The listener must be in a different browser or on the live server because:
- Same browser tabs share the same audio element
- WebRTC requires separate browser contexts for proper testing

## Console Logs

Added helpful console logs for debugging:

- `[party-host] Creating new audio capture` - New AudioContext created
- `[party-host] Reusing existing audio capture` - Reusing existing AudioContext
- `[party-host] Creating new producer` - New mediasoup producer created
- `[party-host] Producer already active` - Producer already exists
- `[party-host] Session active on mount, ensuring producer` - Restoring producer on mount
- `[party-host] Session active but disconnected, reconnecting...` - Auto-reconnecting

## Files Changed

1. `web/stores/partyHost.ts` - New Pinia store
2. `web/composables/usePartyHost.ts` - Refactored to use store and dynamic producer
3. `web/components/player/AudioPlayer.vue` - Added party active state indicator
4. `web/plugins/pinia-persistence.client.ts` - New persistence plugin
