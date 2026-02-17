# Product Requirements Document

## Project: Music Party Mode (WebRTC)

## 1. Objective

Build a browser-based listen-along system where: - Host plays local
audio files - Audio is streamed in real time via WebRTC - Listeners
access via URL and hear stream - No client installation required

## 2. Users

### Host

-   Controls playback in local DMP
-   Streams local files from MUSIC_DIR

### Listener

-   Opens URL
-   Listens via browser
-   Has no control over playback except pause/volume

## 3. System Overview

Host Browser (captures audio output) ↓ WebRTC (publish) SFU Server
(relays media) ↓ WebRTC (subscribe) Listener Browsers

WebSocket channel used for signaling and metadata.

## 4. Functional Requirements

### 4.1 Sessions

-   Host creates session
-   Server returns sessionId and inviteUrl
-   Listeners join via URL
-   App runs in stream mode when STREAM=true

### 4.2 Playback

-   Host presses play
-   Audio is captured from player
-   Audio is streamed to SFU
-   SFU relays to all listeners

Controls: - play - pause - volume

### 4.3 Streaming

-   Source: local files
-   Codec: Opus (preferred) or MP3
-   Transport: WebRTC
-   Latency target: \< 1 second

### 4.4 Listener

-   Connects to WebRTC session
-   Receives audio track
-   Plays via HTMLAudioElement
-   Auto-reconnect on failure

### 4.5 Metadata Sync

WebSocket events:

{ "type": "nowPlaying", "track": "string", "startedAt": number }

{ "type": "pause" }

{ "type": "resume" }

## 5. Architecture

### Components

Host Web App: - Audio player - Captures audio via Web Audio API -
Publishes MediaStream to WebRTC

SFU Server: - WebRTC signaling - Media routing (one-to-many) - Session
management

Listener App: - Connects via WebRTC - Receives audio track - Plays via
audio element

Signaling Server: - WebSocket / Socket.IO - Handles SDP exchange and ICE
candidates

## 6. WebRTC Design

### 6.1 Media Capture (Host)

-   Use AudioContext
-   Connect player output to MediaStreamDestination

Example:

const audio = new Audio("file.mp3") const ctx = new AudioContext() const
source = ctx.createMediaElementSource(audio) const dest =
ctx.createMediaStreamDestination()

source.connect(dest) source.connect(ctx.destination)

const stream = dest.stream

### 6.2 Publishing

-   Create RTCPeerConnection
-   Add audio track from stream
-   Send offer to server
-   Server routes via SFU

### 6.3 SFU (Selective Forwarding Unit)

Responsibilities: - Receive host audio stream - Forward to all
listeners - Do not transcode - Maintain low latency

Recommended implementations: - mediasoup - LiveKit

### 6.4 Subscribing (Listener)

-   Create RTCPeerConnection
-   Receive remote track
-   Attach to audio element

audio.srcObject = remoteStream

### 6.5 Signaling

Use WebSocket for: - SDP exchange - ICE candidates - Session join/leave

Events:

Host: - createOffer - sendTrack

Listener: - joinSession - receiveOffer - sendAnswer

## 7. Session Management

Session { id: string hostId: string peers: \[\] createdAt: timestamp }

## 8. WebSocket Events

Host → Server: - startSession - play(track) - pause

Server → Clients: - nowPlaying - pause - resume

Signaling: - offer - answer - iceCandidate

## 9. Client Playback

-   Use HTMLAudioElement
-   Set srcObject to MediaStream
-   Autoplay (requires user interaction)

## 10. Constraints

Must: - no client installation - browser-only - host streams local
files - no direct inbound connection to host

Should: - support 10--50 listeners - low latency (\<1s)

## 11. Security

-   sessionId must be random
-   only host can publish stream
-   listeners are read-only
-   optional auth tokens

## 12. Performance

-   Opus \~64--128 kbps per listener
-   SFU scales better than P2P

## 13. Edge Cases

-   host disconnect → session ends
-   listener reconnect → resubscribe
-   network changes → ICE restart
-   track change → continuous stream

## 14. Future Improvements

-   adaptive bitrate
-   recording
-   multiple hosts
-   chat

## 15. MVP Criteria

-   host creates session
-   host plays local file
-   audio is streamed via WebRTC
-   listeners hear stream
-   no installation required

## 16. Stack

-   backend: Node.js + Socket.IO
-   WebRTC: mediasoup or LiveKit
-   frontend: Vue
-   audio: Web Audio API

## 17. Key Requirement

Streaming must use WebRTC with SFU architecture.

## 18. Summary

Host captures audio output and publishes via WebRTC. Server (SFU) relays
audio to listeners. Listeners receive and play stream in browser.
