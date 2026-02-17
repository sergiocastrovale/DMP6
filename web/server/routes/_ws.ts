import type { Peer } from 'crossws'
import {
  getPartySession,
  createPartySession,
  destroyPartySession,
  createWebRtcTransport,
  getTransportParams,
  removeListener,
  type PartyTrackMeta,
} from '../utils/party'

type PeerRole = 'host' | 'listener'

interface PeerState {
  role: PeerRole
  peerId: string
}

const peerStates = new Map<Peer, PeerState>()

function broadcast(peers: Set<Peer>, type: string, data: Record<string, unknown> = {}, exclude?: Peer) {
  const msg = JSON.stringify({ type, ...data })
  for (const peer of peers) {
    if (peer !== exclude) {
      try { peer.send(msg) } catch { /* peer gone */ }
    }
  }
}

function send(peer: Peer, type: string, data: Record<string, unknown> = {}) {
  try { peer.send(JSON.stringify({ type, ...data })) } catch { /* peer gone */ }
}

function getListenerCount(): number {
  const session = getPartySession()
  return session ? session.listeners.size : 0
}

export default defineWebSocketHandler({
  open(peer) {
    // Peer connected, wait for identify message
  },

  async message(peer, rawMsg) {
    let msg: Record<string, unknown>
    try {
      const text = typeof rawMsg === 'string' ? rawMsg : rawMsg.text()
      msg = JSON.parse(text)
    }
    catch {
      send(peer, 'error', { message: 'Invalid JSON' })
      return
    }

    const type = msg.type as string

    try {
      switch (type) {
        case 'createSession':
          await handleCreateSession(peer)
          break
        case 'createProducerTransport':
          await handleCreateProducerTransport(peer)
          break
        case 'connectTransport':
          await handleConnectTransport(peer, msg)
          break
        case 'produce':
          await handleProduce(peer, msg)
          break
        case 'nowPlaying':
          handleNowPlaying(peer, msg)
          break
        case 'pause':
          handlePause(peer)
          break
        case 'resume':
          handleResume(peer)
          break
        case 'position':
          handlePosition(peer, msg)
          break
        case 'endSession':
          await handleEndSession(peer)
          break
        case 'join':
          handleJoin(peer)
          break
        case 'createConsumerTransport':
          await handleCreateConsumerTransport(peer)
          break
        case 'consume':
          await handleConsume(peer, msg)
          break
        case 'resumeConsumer':
          await handleResumeConsumer(peer)
          break
        default:
          send(peer, 'error', { message: `Unknown message type: ${type}` })
      }
    }
    catch (err) {
      console.error(`[ws] Error handling ${type}:`, err)
      send(peer, 'error', { message: (err as Error).message })
    }
  },

  close(peer) {
    const state = peerStates.get(peer)
    if (!state) return

    if (state.role === 'host') {
      const session = getPartySession()
      if (session) {
        // Notify all listeners that session ended
        for (const [, listener] of session.listeners) {
          // Find the peer for this listener and notify
        }
        destroyPartySession()
      }
      // Broadcast session ended to all connected peers
      broadcastToAllListeners('sessionEnded', {})
    }
    else if (state.role === 'listener') {
      removeListener(state.peerId)
      const hostPeer = findHostPeer()
      if (hostPeer) {
        send(hostPeer, 'listenerCount', { count: getListenerCount() })
      }
    }

    peerStates.delete(peer)
  },
})

function findHostPeer(): Peer | undefined {
  for (const [peer, state] of peerStates) {
    if (state.role === 'host') return peer
  }
  return undefined
}

function broadcastToAllListeners(type: string, data: Record<string, unknown>) {
  for (const [peer, state] of peerStates) {
    if (state.role === 'listener') {
      send(peer, type, data)
    }
  }
}

async function handleCreateSession(peer: Peer) {
  const session = await createPartySession()

  peerStates.set(peer, { role: 'host', peerId: 'host' })

  send(peer, 'sessionCreated', {
    sessionId: session.id,
    routerRtpCapabilities: session.router.rtpCapabilities,
  })
}

async function handleCreateProducerTransport(peer: Peer) {
  const session = getPartySession()
  if (!session) {
    send(peer, 'error', { message: 'No active session' })
    return
  }

  const transport = await createWebRtcTransport(session.router)
  session.hostTransport = transport

  send(peer, 'producerTransportCreated', getTransportParams(transport))
}

async function handleConnectTransport(peer: Peer, msg: Record<string, unknown>) {
  const session = getPartySession()
  if (!session) return

  const state = peerStates.get(peer)
  if (!state) return

  const dtlsParameters = msg.dtlsParameters as any

  if (state.role === 'host' && session.hostTransport) {
    await session.hostTransport.connect({ dtlsParameters })
    send(peer, 'transportConnected', {})
  }
  else if (state.role === 'listener') {
    const listener = session.listeners.get(state.peerId)
    if (listener?.transport) {
      await listener.transport.connect({ dtlsParameters })
      send(peer, 'transportConnected', {})
    }
  }
}

async function handleProduce(peer: Peer, msg: Record<string, unknown>) {
  const session = getPartySession()
  if (!session || !session.hostTransport) {
    send(peer, 'error', { message: 'No transport available' })
    return
  }

  const { kind, rtpParameters } = msg as any

  const producer = await session.hostTransport.produce({
    kind,
    rtpParameters,
  })

  session.hostProducer = producer

  producer.on('transportclose', () => {
    session.hostProducer = null
  })

  send(peer, 'produced', { producerId: producer.id })

  // Notify existing listeners that a producer is available
  broadcastToAllListeners('producerAvailable', {})
}

function handleNowPlaying(peer: Peer, msg: Record<string, unknown>) {
  const session = getPartySession()
  if (!session) return

  session.currentTrack = msg.track as PartyTrackMeta
  session.isPlaying = true
  session.currentTime = 0
  session.duration = (msg.track as any)?.duration || 0

  broadcastToAllListeners('nowPlaying', { track: session.currentTrack })
}

function handlePause(peer: Peer) {
  const session = getPartySession()
  if (!session) return

  session.isPlaying = false
  broadcastToAllListeners('pause', {})
}

function handleResume(peer: Peer) {
  const session = getPartySession()
  if (!session) return

  session.isPlaying = true
  broadcastToAllListeners('resume', {})
}

function handlePosition(peer: Peer, msg: Record<string, unknown>) {
  const session = getPartySession()
  if (!session) return

  session.currentTime = msg.currentTime as number
  session.duration = msg.duration as number

  broadcastToAllListeners('position', {
    currentTime: session.currentTime,
    duration: session.duration,
  })
}

async function handleEndSession(peer: Peer) {
  broadcastToAllListeners('sessionEnded', {})
  await destroyPartySession()
  send(peer, 'sessionEnded', {})
}

function handleJoin(peer: Peer) {
  const session = getPartySession()
  if (!session) {
    send(peer, 'error', { message: 'No active session' })
    return
  }

  const peerId = crypto.randomUUID()
  peerStates.set(peer, { role: 'listener', peerId })
  session.listeners.set(peerId, { peerId, transport: null, consumer: null })

  send(peer, 'joined', {
    sessionId: session.id,
    routerRtpCapabilities: session.router.rtpCapabilities,
    currentTrack: session.currentTrack,
    isPlaying: session.isPlaying,
    currentTime: session.currentTime,
    duration: session.duration,
  })

  const hostPeer = findHostPeer()
  if (hostPeer) {
    send(hostPeer, 'listenerCount', { count: getListenerCount() })
  }
}

async function handleCreateConsumerTransport(peer: Peer) {
  const session = getPartySession()
  const state = peerStates.get(peer)
  if (!session || !state) return

  const transport = await createWebRtcTransport(session.router)
  const listener = session.listeners.get(state.peerId)
  if (listener) {
    listener.transport = transport
  }

  send(peer, 'consumerTransportCreated', getTransportParams(transport))
}

async function handleConsume(peer: Peer, msg: Record<string, unknown>) {
  const session = getPartySession()
  const state = peerStates.get(peer)
  if (!session || !state || !session.hostProducer) {
    send(peer, 'error', { message: 'No producer available' })
    return
  }

  const listener = session.listeners.get(state.peerId)
  if (!listener?.transport) {
    send(peer, 'error', { message: 'No consumer transport' })
    return
  }

  const rtpCapabilities = msg.rtpCapabilities as any

  if (!session.router.canConsume({
    producerId: session.hostProducer.id,
    rtpCapabilities,
  })) {
    send(peer, 'error', { message: 'Cannot consume' })
    return
  }

  const consumer = await listener.transport.consume({
    producerId: session.hostProducer.id,
    rtpCapabilities,
    paused: true,
  })

  listener.consumer = consumer

  consumer.on('transportclose', () => {
    listener.consumer = null
  })

  consumer.on('producerclose', () => {
    send(peer, 'producerClosed', {})
    listener.consumer = null
  })

  send(peer, 'consumed', {
    consumerId: consumer.id,
    producerId: session.hostProducer.id,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  })
}

async function handleResumeConsumer(peer: Peer) {
  const session = getPartySession()
  const state = peerStates.get(peer)
  if (!session || !state) return

  const listener = session.listeners.get(state.peerId)
  if (listener?.consumer) {
    await listener.consumer.resume()
    send(peer, 'consumerResumed', {})
  }
}
