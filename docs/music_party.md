# Music Party Mode - WebRTC Live Streaming

## Overview

Music Party Mode enables real-time audio streaming from a host's local DMP instance to remote listeners via WebRTC. The host plays music from their local library, and listeners can tune in through their browsers to hear the same audio stream with synchronized metadata (track info, play/pause state, playback position).

### Key Features

- **Browser-only**: No client installation required for listeners
- **Real-time streaming**: Audio transmitted via WebRTC with <1 second latency
- **Synchronized metadata**: Track title, artist, cover art, play/pause, and position synced to all listeners
- **Read-only listener mode**: Listeners browse the full DMP catalog but cannot control playback
- **Auto-reconnect**: Listeners automatically reconnect if connection drops
- **Single session**: One active party session at a time (host-controlled)

## Architecture

```
┌─────────────────────┐
│   Host Browser      │
│   (Local DMP)       │
│                     │
│  Audio Player       │
│  Web Audio API      │
│  mediasoup-client   │
└──────────┬──────────┘
           │ WebSocket + WebRTC
           │ (audio track + metadata)
           ▼
┌─────────────────────┐
│  DigitalOcean       │
│  Server             │
│                     │
│  Nuxt/Nitro         │
│  mediasoup (SFU)    │
│  WebSocket          │
└──────────┬──────────┘
           │ WebSocket + WebRTC
           │ (relayed audio + metadata)
           ▼
┌─────────────────────┐
│  Listener Browsers  │
│  (Remote)           │
│                     │
│  mediasoup-client   │
│  HTMLAudioElement   │
│  Read-only UI       │
└─────────────────────┘
```

### Component Breakdown

**Host (Local DMP)**
- Runs with `PARTY_ENABLED=true` and `PARTY_ROLE=host`
- `PARTY_URL` points to the remote server
- Captures audio from the player's `HTMLAudioElement` via Web Audio API
- Publishes audio track to mediasoup via WebRTC
- Sends metadata updates (nowPlaying, pause, resume, position) via WebSocket
- UI: Party button in AudioPlayer, `/party` management page

**Server (DigitalOcean)**
- Runs with `PARTY_ENABLED=true` and `PARTY_ROLE=listener`
- mediasoup Worker handles WebRTC media routing (SFU = Selective Forwarding Unit)
- WebSocket handler manages signaling (SDP/ICE exchange) and metadata broadcast
- Single session manager tracks host producer and listener consumers
- Relays audio from host to all listeners without transcoding

**Listeners (Remote Browsers)**
- Connect to the server running with `PARTY_ROLE=listener`
- Subscribe to the host's audio track via mediasoup-client
- Receive metadata updates and sync UI state
- Auto-connect on page load if session is active
- UI: Full DMP app in read-only mode (no play buttons, favorites, or playlists)

## Technical Decisions

### Why mediasoup?

- **SFU architecture**: Scales better than P2P for multiple listeners (1 upload from host, N downloads)
- **No transcoding**: Low CPU usage, minimal latency
- **Production-ready**: Battle-tested in production environments
- **TypeScript**: Strong typing for both server and client

### Why Web Audio API?

- **Audio capture**: Captures the output of the `HTMLAudioElement` without recording/re-encoding
- **Low latency**: Direct stream from the audio element to WebRTC
- **Browser native**: No external dependencies or plugins

### Why WebSocket for metadata?

- **Separate channel**: Metadata (track info, play/pause) doesn't need to be embedded in audio
- **Reliability**: WebSocket provides reliable delivery for state updates
- **Simplicity**: Easier to implement than data channels

### Why single session?

- **Simplicity**: One host (you), one active stream at a time
- **Resource efficiency**: No need to manage multiple concurrent sessions
- **Clear UX**: Listeners always connect to "the" active session

### Why separate PARTY_ENABLED and PARTY_ROLE?

- **Explicit control**: Both host and server must opt-in to party mode
- **Clear separation**: `PARTY_ROLE` makes it obvious which instance is the host vs listener
- **Safety**: Prevents accidental activation of party features
- **Flexibility**: Easy to disable party mode without changing other config

## How It Works

### Session Lifecycle

1. **Host creates session** (`/party` page)
   - WebSocket connects to `PARTY_URL`
   - Sends `createSession` message
   - Server creates mediasoup Router with Opus codec
   - Server returns `sessionId` and RTP capabilities
   - Host loads mediasoup-client Device

2. **Host publishes audio**
   - Captures audio via Web Audio API: `AudioContext` → `createMediaElementSource(audio)` → `createMediaStreamDestination()`
   - Creates `SendTransport` from Device
   - Produces audio track (Opus codec)
   - Server creates Producer and stores reference

3. **Listener joins**
   - Navigates to DMP site (e.g., `https://discodomeuprimo.online`)
   - Checks `/api/party/status` to see if session is active
   - If active, auto-connects via WebSocket
   - Sends `join` message
   - Server returns RTP capabilities and current track state

4. **Listener subscribes**
   - Loads mediasoup-client Device
   - Creates `RecvTransport`
   - Consumes the host's Producer
   - Attaches received `MediaStreamTrack` to `HTMLAudioElement.srcObject`
   - Audio plays automatically (after user gesture)

5. **Metadata sync**
   - Host watches player store state changes
   - On track change: sends `nowPlaying` with track metadata
   - On play/pause: sends `pause` or `resume`
   - Every 1 second: sends `position` with `currentTime` and `duration`
   - Server broadcasts all metadata to all listeners
   - Listeners update UI state and interpolate position between updates

6. **Session ends**
   - Host clicks "End Session" or closes browser
   - Server broadcasts `sessionEnded` to all listeners
   - All transports/consumers/producers closed
   - Listeners disconnect and stop playback

### Listener Mode

When `PARTY_ENABLED=true` and `PARTY_ROLE=listener` are set on the server:

- **UI changes**: Play buttons, favorite buttons, and playlist features hidden
- **Navigation**: Playlists and Favorites pages redirect to home
- **AudioPlayer**: Becomes read-only (only play/pause, volume, and track info visible)
- **Auto-connect**: Listeners automatically connect to active session on page load
- **Polling**: If no session active, polls `/api/party/status` every 5 seconds
- **Listener count**: Shows "N users connected" below volume control

## Configuration

### Environment Variables Explained

**PARTY_ENABLED** (boolean)
- Set to `true` to enable party mode
- Must be `true` on both host and listener for party to work
- When `false`, all party features are disabled

**PARTY_ROLE** (string: `host` or `listener`)
- `host`: Local DMP instance that streams audio to the server
- `listener`: Server instance that receives audio and serves to remote listeners
- Determines which UI features are available

**PARTY_URL** (string)
- Host: URL of the remote server (e.g., `https://discodomeuprimo.online`)
- Listener: Can be left empty or set to own domain
- Used for WebSocket connection and invite links

**MEDIASOUP_ANNOUNCED_IP** (string, listener only)
- Public IP address of the server for WebRTC connections
- Required for listeners to establish media connections
- Not needed for host

**RTC_MIN_PORT / RTC_MAX_PORT** (numbers, listener only)
- UDP port range for WebRTC media (default: 10000-10100)
- Must be open in firewall
- Not needed for host

### Host Setup (Local DMP)

**1. Environment Variables** (`web/.env`)

```bash
# Enable party mode
PARTY_ENABLED=true

# Set role as host (streams audio to remote server)
PARTY_ROLE=host

# Point to your remote server where listeners connect
PARTY_URL=https://discodomeuprimo.online

# All other existing vars (MUSIC_DIR, DATABASE_URL, etc.)
```

**2. Start DMP**

```bash
cd web
pnpm dev
```

**3. Create Session**

- Navigate to `http://localhost:3000/party`
- Click "Start Session"
- Copy the invite URL and share with listeners
- Play music as normal - audio is automatically streamed

### Server Setup (DigitalOcean)

**1. Environment Variables** (`web/.env`)

```bash
# Enable party mode
PARTY_ENABLED=true

# Set role as listener (receives audio from host and serves to listeners)
PARTY_ROLE=listener

# Server's own URL (optional, can be left empty)
PARTY_URL=

# mediasoup configuration (required for listener role)
MEDIASOUP_ANNOUNCED_IP=<your-server-public-ip>
RTC_MIN_PORT=10000
RTC_MAX_PORT=10100

# Optional: Secret for session authentication (future use)
PARTY_SECRET=

# All other existing vars (DATABASE_URL, S3 config, etc.)
```

**2. Firewall Configuration**

Open UDP ports for WebRTC media:

```bash
# DigitalOcean Firewall or ufw
sudo ufw allow 10000:10100/udp
```

**3. System Dependencies**

mediasoup requires native build tools (already installed during `pnpm install`):

```bash
# If needed:
sudo apt update
sudo apt install -y python3 make g++
```

**4. Build and Deploy**

```bash
cd web
pnpm install  # Builds mediasoup native worker
pnpm build
pm2 start ecosystem.config.js --env production
```

**5. Verify**

Check that mediasoup worker starts:

```bash
pm2 logs
# Should see: [mediasoup] Worker started [pid:XXXXX, ports:10000-10100]
```

### Listener Access

Listeners simply navigate to your DMP URL:

```
https://discodomeuprimo.online
```

- If a session is active, they auto-connect and see a "Live" indicator in the player
- They can browse the catalog but cannot play tracks or manage favorites/playlists
- Play/pause button controls their local audio playback (not the host's)
- Volume control works locally

## Key Files

### Server-Side

| File | Purpose |
|------|---------|
| `server/plugins/mediasoup.ts` | Initializes mediasoup Worker on server start |
| `server/utils/party.ts` | Session manager: creates Router, Transports, Producers, Consumers |
| `server/routes/_ws.ts` | WebSocket handler for signaling and metadata |
| `server/api/party/status.get.ts` | REST endpoint for session status |

### Client-Side

| File | Purpose |
|------|---------|
| `composables/useStreamMode.ts` | Detects if running in stream mode |
| `composables/usePartyHost.ts` | Host-side audio capture and publishing |
| `composables/usePartyListener.ts` | Listener-side audio subscription |
| `pages/party.vue` | Host session management UI |
| `components/player/AudioPlayer.vue` | Modified for party button and stream mode |

### Modified Components

Stream-mode guards (`v-if="!isStreamMode"`) added to:
- `TrackList.vue` - Play button and favorite column
- `ReleaseCover.vue` - Play overlay
- `ArtistReleases.vue` - Play button on covers
- `ReleaseGrid.vue` - Play overlay
- `SearchDropdown.vue` - Play actions
- `Sidebar.vue` / `MobileNav.vue` - Playlists/Favorites nav items
- `pages/index.vue` - Playlists/Favorites sections
- `pages/favorites.vue`, `pages/playlists/*.vue` - Redirect to home

## Key Takeaways

### What Works Well

✅ **Low latency**: WebRTC + mediasoup achieves <1s latency for audio streaming  
✅ **Scalable**: SFU architecture supports 50+ concurrent listeners on a single VPS  
✅ **No installation**: Listeners need only a modern browser  
✅ **Synchronized UI**: Metadata sync keeps all listeners in sync with the host  
✅ **Auto-reconnect**: Listeners automatically reconnect on network issues  
✅ **Read-only mode**: Clean separation between host and listener capabilities  

### Limitations

⚠️ **Single session**: Only one active party at a time (by design)  
⚠️ **Host dependency**: Session ends if host disconnects  
⚠️ **Browser autoplay**: Listeners may need to click play due to browser autoplay policies  
⚠️ **UDP firewall**: Requires UDP ports open on the server (common for WebRTC)  

### Future Improvements

- **Multiple hosts**: Support concurrent sessions from different hosts
- **Recording**: Record party sessions for later playback
- **Chat**: Add text chat between host and listeners
- **Adaptive bitrate**: Adjust quality based on listener bandwidth
- **Listener controls**: Allow listeners to request tracks (with host approval)
- **Analytics**: Track listener count over time, popular tracks, etc.

## Troubleshooting

### Host: "WebSocket connection failed"

- Check `PARTY_URL` is correct and server is running
- Verify server is accessible from host machine
- Check server logs for errors

### Listeners: No audio playing

- Check browser console for errors
- Verify session is active (check `/api/party/status`)
- Try clicking the play button (browser autoplay policy)
- Check browser supports WebRTC (all modern browsers do)

### Server: "mediasoup worker died"

- Check system resources (CPU, memory)
- Verify UDP ports are open in firewall
- Check server logs for crash details
- Worker auto-restarts after 2s

### Audio quality issues

- Check network bandwidth (Opus at 64-128 kbps per listener)
- Verify no packet loss on server network
- Check CPU usage on server (mediasoup is efficient but not free)

## Performance Considerations

### Server Resources

- **CPU**: ~5-10% per listener (no transcoding, just forwarding)
- **Memory**: ~50MB base + ~10MB per listener
- **Bandwidth**: ~128 kbps upload per listener (Opus codec)
- **UDP ports**: 1 port per listener (from the configured range)

### Recommended Server Specs

For 50 listeners:
- **CPU**: 2 cores
- **RAM**: 2GB
- **Bandwidth**: 10 Mbps upload
- **OS**: Ubuntu 22.04 LTS

### Scaling Beyond 50 Listeners

- Add more mediasoup Workers (multi-core)
- Use multiple servers with load balancing
- Consider a dedicated media server (not on the same VPS as the web app)

## Security Notes

- **Session ID**: Randomly generated UUID (not guessable)
- **Host-only publishing**: Only the host can publish audio (enforced server-side)
- **Read-only listeners**: Listeners cannot control playback or modify data
- **HTTPS required**: WebRTC requires secure context (HTTPS) in production
- **Future**: Add `PARTY_SECRET` for session authentication

## References

- [mediasoup documentation](https://mediasoup.org/documentation/v3/)
- [mediasoup-client API](https://mediasoup.org/documentation/v3/mediasoup-client/api/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
