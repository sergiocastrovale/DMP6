# Music Party Mode

## Quick Overview

**Music Party Mode** enables you to stream audio from your local DMP instance to remote listeners in real-time via WebRTC. You play music from your local library, and anyone with the invite link can tune in through their browser—no installation required.

### What You Can Do

- 🎵 **Stream your local music** to friends anywhere in the world
- 🎧 **Low latency** audio streaming (<1 second delay)
- 📱 **Browser-only** - listeners need no installation
- 🔄 **Synchronized metadata** - track info, play/pause, and position synced to all listeners
- 👥 **Scalable** - supports 50+ concurrent listeners on a single VPS
- 🔒 **Read-only mode** - listeners can browse your catalog but can't control playback

### How It Works (Simple)

1. **You (Host)**: Start a party session on your local DMP
2. **Your Server**: Receives your audio stream and relays it to listeners
3. **Your Friends (Listeners)**: Visit your DMP URL and automatically hear what you're playing

---

## Feature Guide

### For Hosts (You)

#### Starting a Party

1. Make sure your local DMP is configured with Party Mode enabled
2. Navigate to `http://localhost:3000/party`
3. Click **"Start Session"**
4. Share the invite URL with your friends
5. Play music as normal—audio automatically streams

#### What You See

- **Party button** in the audio player (turns amber when active)
- **Live indicator** on the `/party` page
- **Listener count** showing how many people are connected
- **Session ID** for reference

#### Controlling the Party

- **Play/Pause**: Controls affect all listeners
- **Track changes**: Automatically synced to listeners
- **Volume**: Your local volume (doesn't affect listeners)
- **End session**: Click "End Session" on `/party` page

### For Listeners (Your Friends)

#### Joining a Party

1. Open the invite URL (e.g., `https://discodomeuprimo.online`)
2. If a session is active, you'll automatically connect
3. See a **"Live"** indicator in the player
4. Hear the audio streaming from the host

#### What You Can Do

- **Browse the catalog**: See all artists, releases, and tracks
- **View track info**: See what's currently playing
- **Control your volume**: Adjust your local playback volume
- **Pause locally**: Pause your own audio (doesn't affect the host)

#### What You Can't Do

- ❌ Play tracks (read-only mode)
- ❌ Add to favorites
- ❌ Create/edit playlists
- ❌ Control the host's playback

---

## Architecture & Technical Details

### System Architecture

```
┌─────────────────────┐
│   Host Browser      │  You play music locally
│   (Local DMP)       │  
│                     │  
│  Audio Player       │  
│  Web Audio API      │  Captures audio from <audio> element
│  mediasoup-client   │  Publishes audio track via WebRTC
└──────────┬──────────┘
           │ 
           │ WebSocket (signaling + metadata)
           │ WebRTC (audio stream)
           │
           ▼
┌─────────────────────┐
│  Production Server  │  Relays audio to listeners
│  (DigitalOcean)     │  
│                     │  
│  Nuxt/Nitro         │  Web server
│  mediasoup (SFU)    │  WebRTC media router
│  WebSocket Handler  │  Signaling & metadata
└──────────┬──────────┘
           │ 
           │ WebSocket (signaling + metadata)
           │ WebRTC (audio stream)
           │
           ▼
┌─────────────────────┐
│  Listener Browsers  │  Friends hear your music
│  (Remote)           │  
│                     │  
│  mediasoup-client   │  Subscribes to audio track
│  HTMLAudioElement   │  Plays received audio
│  Read-only UI       │  Browse-only interface
└─────────────────────┘
```

### Key Technologies

**mediasoup (SFU)**
- Selective Forwarding Unit for WebRTC
- Scales better than peer-to-peer (1 upload from host → N downloads to listeners)
- No transcoding = low CPU usage and minimal latency
- Production-ready and battle-tested

**Web Audio API**
- Captures audio output from the HTML audio element
- Creates a MediaStream for WebRTC without re-encoding
- Low latency, browser-native

**WebSocket**
- Separate channel for metadata (track info, play/pause state)
- Reliable delivery for state synchronization
- Simpler than WebRTC data channels

**Opus Codec**
- High-quality audio at 64-128 kbps
- Optimized for real-time streaming
- Low latency encoding/decoding

### Component Breakdown

#### Host (Local DMP)

**Configuration:**
- `PARTY_ENABLED=true`
- `PARTY_ROLE=host`
- `PARTY_URL=https://your-server.com`

**Responsibilities:**
- Captures audio from the audio player via Web Audio API
- Creates mediasoup Device and SendTransport
- Publishes audio track to the server
- Sends metadata updates (nowPlaying, pause, resume, position) via WebSocket
- Displays party management UI

**Key Files:**
- `composables/usePartyHost.ts` - Audio capture and publishing logic
- `stores/partyHost.ts` - Session state management (Pinia)
- `pages/party.vue` - Session management UI
- `components/player/AudioPlayer.vue` - Party button and controls

#### Server (Production)

**Configuration:**
- `PARTY_ENABLED=true`
- `PARTY_ROLE=listener`
- `MEDIASOUP_ANNOUNCED_IP=<server-public-ip>`
- `RTC_MIN_PORT=10000`, `RTC_MAX_PORT=10100`

**Responsibilities:**
- Initializes mediasoup Worker for WebRTC routing
- Creates Router with Opus codec support
- Manages WebRTC transports (host SendTransport, listener RecvTransports)
- Routes audio from host Producer to listener Consumers
- Broadcasts metadata to all connected listeners

**Key Files:**
- `server/plugins/mediasoup.ts` - Initializes mediasoup Worker
- `server/utils/party.ts` - Session management (Router, Transports, Producers, Consumers)
- `server/routes/_ws.ts` - WebSocket handler for signaling and metadata
- `server/api/party/status.get.ts` - REST endpoint for session status

#### Listeners (Remote Browsers)

**Configuration:**
- Automatically detected via `PARTY_ROLE=listener` on the server
- No configuration needed for listeners

**Responsibilities:**
- Connects to WebSocket on page load
- Creates mediasoup Device and RecvTransport
- Consumes the host's audio Producer
- Attaches received MediaStreamTrack to HTMLAudioElement
- Displays read-only UI (no play buttons, favorites, or playlists)

**Key Files:**
- `composables/usePartyListener.ts` - Audio subscription logic
- `composables/useStreamMode.ts` - Detects listener mode
- Modified components with `v-if="!isStreamMode"` guards

### Session Lifecycle

#### 1. Host Creates Session

```
Host                    Server
  |                       |
  |--createSession------->|
  |                       | Creates Router
  |                       | Returns sessionId + RTP capabilities
  |<--sessionCreated------|
  |                       |
  | Loads mediasoup Device|
  | with RTP capabilities |
```

#### 2. Host Publishes Audio

```
Host                    Server
  |                       |
  |--createProducerTransport->|
  |<--transportCreated----|
  |                       |
  | Creates SendTransport |
  |                       |
  | Captures audio via    |
  | Web Audio API         |
  |                       |
  |--produce(audioTrack)->|
  |                       | Creates Producer
  |<--produced(id)--------|
  |                       |
  | Audio streaming...    |
```

#### 3. Listener Joins

```
Listener                Server
  |                       |
  |--join---------------->|
  |                       | Returns RTP capabilities
  |                       | + current track state
  |<--joined--------------|
  |                       |
  | Loads mediasoup Device|
```

#### 4. Listener Subscribes

```
Listener                Server
  |                       |
  |--createConsumerTransport->|
  |<--transportCreated----|
  |                       |
  | Creates RecvTransport |
  |                       |
  |--consume------------->|
  |                       | Creates Consumer
  |                       | from host's Producer
  |<--consumed(track)-----|
  |                       |
  | Attaches track to     |
  | HTMLAudioElement      |
  |                       |
  |--resumeConsumer------>|
  |<--consumerResumed-----|
  |                       |
  | Audio playing...      |
```

#### 5. Metadata Sync

```
Host                    Server                  Listeners
  |                       |                       |
  |--nowPlaying(track)--->|                       |
  |                       |--nowPlaying(track)--->|
  |                       |                       | Updates UI
  |                       |                       |
  |--pause--------------->|                       |
  |                       |--pause--------------->|
  |                       |                       | Pauses audio
  |                       |                       |
  |--position(time)------>|                       |
  |                       |--position(time)------>|
  |                       |                       | Updates progress
```

#### 6. Session Ends

```
Host                    Server                  Listeners
  |                       |                       |
  |--endSession---------->|                       |
  |                       | Closes all transports |
  |                       |                       |
  |                       |--sessionEnded-------->|
  |                       |                       | Disconnects
  |<--sessionEnded--------|                       | Stops playback
```

### State Management

#### Host State (Pinia Store)

**Reactive State** (persisted in sessionStorage):
- `isActive` - Whether a session is currently active
- `sessionId` - UUID of the current session
- `listenerCount` - Number of connected listeners
- `inviteUrl` - URL to share with listeners
- `error` - Error message if any
- `isConnecting` - Whether currently connecting

**Module-Level Objects** (not reactive, not persisted):
- `ws` - WebSocket connection
- `device` - mediasoup Device
- `sendTransport` - mediasoup SendTransport
- `producer` - mediasoup Producer
- `audioContext` - Web Audio API AudioContext
- `mediaStream` - MediaStream from audio capture
- `positionInterval` - Timer for position updates

**Why This Design?**
- Reactive state persists across page navigation (sessionStorage)
- Connection objects can't be serialized, so they live at module scope
- When navigating back, the composable checks if connections are still alive
- If disconnected, automatically reconnects using persisted session state

#### Listener State

**Simple Refs** (not persisted):
- `isConnected` - Whether connected to the session
- `currentTrack` - Current track metadata
- `isPlaying` - Whether audio is playing
- `currentTime` - Current playback position
- `duration` - Track duration
- `error` - Error message if any
- `isReconnecting` - Whether attempting to reconnect

**Module-Level Objects**:
- `ws` - WebSocket connection
- `device` - mediasoup Device
- `recvTransport` - mediasoup RecvTransport
- `consumer` - mediasoup Consumer
- `audioEl` - HTMLAudioElement for playback

### Audio Capture (Host)

The host captures audio from the HTML audio element using the Web Audio API:

```javascript
// 1. Get the audio element from the player
const audioEl = player.getAudioElement()

// 2. Create an AudioContext
const audioContext = new AudioContext()

// 3. Create a source from the audio element
const source = audioContext.createMediaElementSource(audioEl)

// 4. Create a destination for the stream
const dest = audioContext.createMediaStreamDestination()

// 5. Connect source to both destination (for streaming) and speakers (for local playback)
source.connect(dest)
source.connect(audioContext.destination)

// 6. Get the MediaStream
const mediaStream = dest.stream

// 7. Extract the audio track
const audioTrack = mediaStream.getAudioTracks()[0]

// 8. Publish to mediasoup
const producer = await sendTransport.produce({ track: audioTrack })
```

**Important Notes:**
- `createMediaElementSource()` can only be called once per audio element
- The solution reuses the AudioContext and MediaStream if they already exist
- The producer is created dynamically when playback starts (not at session start)

### Dynamic Producer Creation

The producer is created on-demand when playback actually starts:

```javascript
// Watch for playback state changes
watch(() => player.isPlaying, async (playing) => {
  if (playing && player.currentTrack) {
    // Ensure we have an active producer
    await ensureProducer()
  }
})
```

**Why Dynamic?**
- User might start a session before playing any music
- User might navigate away and back while music is playing
- AudioContext can only be created once per audio element

### WebRTC Configuration

**ICE Servers:**
- Currently uses browser default STUN servers
- Future: Add custom STUN/TURN servers for better connectivity

**Transport Settings:**
- Protocol: UDP (preferred) and TCP (fallback)
- Port range: 10000-10100 (configurable)
- Announced IP: Server's public IP address

**Codec:**
- Audio: Opus at 48kHz, 2 channels
- Bitrate: 64-128 kbps (adaptive)

---

## Developer Guide

### Prerequisites

- Node.js 18+ and pnpm
- PostgreSQL database
- DigitalOcean VPS (or similar) with:
  - Ubuntu 22.04 LTS
  - 2 CPU cores, 2GB RAM
  - Public IP address
  - Domain name with SSL certificate

### Local Setup (Host)

#### 1. Install Dependencies

```bash
cd web
pnpm install
```

#### 2. Configure Environment

Create `web/.env`:

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/dmp

# Music directory
MUSIC_DIR=/path/to/your/music

# Party Mode (Host)
PARTY_ENABLED=true
PARTY_ROLE=host
PARTY_URL=https://your-domain.com

# All other existing vars...
```

#### 3. Start Development Server

```bash
pnpm dev
```

#### 4. Test Party Mode

1. Navigate to `http://localhost:3000/party`
2. Click "Start Session"
3. Play a track
4. Check browser console for:
   - `[party-host] Creating new producer`
   - `[party-host] Producer created successfully`

### Production Setup (Server)

#### 1. Configure Local Environment

Add deployment settings to your local `web/.env`:

```bash
# Server connection
SERVER_HOST=your-server-ip
SERVER_USER=root
DEPLOY_PATH=/var/www/dmp
SSH_KEY_PATH=~/.ssh/your_key

# Deployment database
DEPLOY_DB_NAME=dmp
DEPLOY_DB_USER=dmp_user
DEPLOY_DB_PASSWORD=secure_password
DEPLOY_DOMAIN=your-domain.com

# Party Mode (local host config)
PARTY_ENABLED=true
PARTY_ROLE=host
PARTY_URL=https://your-domain.com

# WebRTC ports (for server)
RTC_MIN_PORT=10000
RTC_MAX_PORT=10100
```

#### 2. Run Server Setup (First Time Only)

```bash
cd web/scripts
./run-server-setup.sh
```

This script:
- ✅ Installs Node.js, PostgreSQL, PM2, Nginx, Certbot
- ✅ Configures firewall (SSH, HTTP, HTTPS, WebRTC ports)
- ✅ Sets up SSL certificate with Let's Encrypt
- ✅ Creates database and user
- ✅ Configures Nginx with WebSocket support

#### 3. Deploy Application

```bash
cd web
pnpm deploy:app
```

This command:
1. ✅ Builds with `PARTY_ROLE=listener` override (read-only UI)
2. ✅ Syncs built files to server
3. ✅ Auto-creates server `.env` with listener configuration
4. ✅ Sets `MEDIASOUP_ANNOUNCED_IP` to server's public IP
5. ✅ Installs dependencies (including mediasoup native build)
6. ✅ Copies mediasoup worker binary to `.output` directory
7. ✅ Restarts PM2

#### 4. Verify Deployment

Check mediasoup worker started:

```bash
ssh your-server 'pm2 logs dmp --lines 50 | grep mediasoup'
# Should see: [mediasoup] Worker started [pid:XXXXX, ports:10000-10100]
```

Check website is in listener mode:

```bash
curl https://your-domain.com/party-status
# Should show PARTY_ROLE=listener
```

### Deployment Details

#### Why Build Locally with Listener Override?

**Problem:** Nuxt's `runtimeConfig.public` values are baked into the client JavaScript at build time. If we build with `PARTY_ROLE=host`, the production site will show host UI (play buttons, favorites, etc.).

**Solution:** The deploy script temporarily overrides `PARTY_ROLE=listener` during the build:

```typescript
// In deploy.ts
const buildEnv = { ...process.env, PARTY_ROLE: 'listener' }
execSync('pnpm build', { stdio: 'inherit', env: buildEnv })
```

This ensures the production client JavaScript contains listener mode configuration.

#### Server .env Auto-Generation

The deploy script automatically creates `/var/www/dmp/.env` with:

```bash
# Party Mode (Listener) - Auto-configured for production
PARTY_ENABLED=true
PARTY_ROLE=listener
PARTY_URL=
MEDIASOUP_ANNOUNCED_IP=<your-server-ip>  # Auto-set from SERVER_HOST
RTC_MIN_PORT=10000
RTC_MAX_PORT=10100

# Database (copied from local .env)
DATABASE_URL=postgresql://...

# Image storage (copied from local .env)
IMAGE_STORAGE=s3
S3_IMAGE_BUCKET=...
# etc.
```

#### mediasoup Worker Binary

mediasoup includes a native C++ worker binary that must be copied to the `.output` directory:

```bash
# After pnpm install on server
cp node_modules/mediasoup/worker/out/Release/mediasoup-worker \
   .output/server/node_modules/mediasoup/worker/out/Release/
```

The deploy script handles this automatically.

### Testing

#### Local Host Testing

1. **Start session without playing:**

   ```bash
   # Terminal 1
   cd web && pnpm dev
   
   # Browser
   # 1. Go to http://localhost:3000/party
   # 2. Click "Start Session"
   # 3. Navigate to /
   # 4. Party button should be amber
   # 5. Play a track
   # 6. Console: [party-host] Creating new producer
   ```

2. **Navigate during session:**
   ```bash
   # 1. Start session, play track
   # 2. Navigate to /artists, /releases, etc.
   # 3. Party button stays amber
   # 4. Return to /party
   # 5. Session still shows "Live"
   # 6. Console: [party-host] Session active on mount
   ```

3. **Reconnection test:**
   ```bash
   # 1. Start session, play track
   # 2. Refresh page (F5)
   # 3. Session automatically reconnects
   # 4. Console: [party-host] Session active but disconnected, reconnecting...
   ```

#### Listener Testing

**Option 1: Live Server**

1. Deploy to production `cd web && pnpm deploy:app`
2. Start local dev server with `pnpm dev`
3. Locally: Go to `/party`, start session, play track
4. On phone or another device:
  - Open https://your-domain.com
  - Should auto-connect and stream audio

**Option 2: Debug Page**

1. Open https://your-domain.com/party-debug
2. Should show:
   - Connection: Connected (green dot)
   - Current track info
   - Playback: Playing
   - Console: [party-listener] Consumer created
3. You should hear the audio

---

## Support & Resources

- [mediasoup documentation](https://mediasoup.org/documentation/v3/)
- [mediasoup-client API](https://mediasoup.org/documentation/v3/mediasoup-client/api/)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)
