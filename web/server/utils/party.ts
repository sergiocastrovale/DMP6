import type { types as mediasoupTypes } from 'mediasoup'

export interface PartyTrackMeta {
  id: string
  title: string
  artist: string
  artistSlug?: string
  releaseTitle?: string
  releaseId?: string
  coverPath?: string
  duration?: number
}

export interface PartySession {
  id: string
  router: mediasoupTypes.Router
  hostTransport: mediasoupTypes.WebRtcTransport | null
  hostProducer: mediasoupTypes.Producer | null
  listeners: Map<string, PartyListener>
  currentTrack: PartyTrackMeta | null
  isPlaying: boolean
  currentTime: number
  duration: number
  createdAt: number
}

export interface PartyListener {
  peerId: string
  transport: mediasoupTypes.WebRtcTransport | null
  consumer: mediasoupTypes.Consumer | null
}

const mediaCodecs: mediasoupTypes.RouterRtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
  },
]

let worker: mediasoupTypes.Worker | null = null
let session: PartySession | null = null

export function getPartyWorker(): mediasoupTypes.Worker | null {
  return worker
}

export function setPartyWorker(w: mediasoupTypes.Worker) {
  worker = w
}

export function getPartySession(): PartySession | null {
  return session
}

export async function createPartySession(): Promise<PartySession> {
  if (!worker) {
    throw new Error('mediasoup worker not initialized')
  }

  if (session) {
    await destroyPartySession()
  }

  const router = await worker.createRouter({ mediaCodecs })

  const id = crypto.randomUUID()
  session = {
    id,
    router,
    hostTransport: null,
    hostProducer: null,
    listeners: new Map(),
    currentTrack: null,
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    createdAt: Date.now(),
  }

  return session
}

export async function createWebRtcTransport(router: mediasoupTypes.Router): Promise<mediasoupTypes.WebRtcTransport> {
  // Read directly from process.env to get runtime values (not build-time)
  const announcedIp = process.env.MEDIASOUP_ANNOUNCED_IP
  const rtcMinPort = Number(process.env.RTC_MIN_PORT) || 10000
  const rtcMaxPort = Number(process.env.RTC_MAX_PORT) || 10100

  console.log(`[party] Creating WebRTC transport with announcedIp: ${announcedIp || 'none'}, ports: ${rtcMinPort}-${rtcMaxPort}`)

  const transport = await router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: 'udp',
        ip: '0.0.0.0',
        announcedAddress: announcedIp || undefined,
        portRange: {
          min: rtcMinPort,
          max: rtcMaxPort,
        },
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  })

  return transport
}

export function getTransportParams(transport: mediasoupTypes.WebRtcTransport) {
  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  }
}

export async function destroyPartySession(): Promise<void> {
  if (!session) return

  session.hostProducer?.close()
  session.hostTransport?.close()

  for (const listener of session.listeners.values()) {
    listener.consumer?.close()
    listener.transport?.close()
  }

  session.router.close()
  session = null
}

export function removeListener(peerId: string): void {
  if (!session) return
  const listener = session.listeners.get(peerId)
  if (listener) {
    listener.consumer?.close()
    listener.transport?.close()
    session.listeners.delete(peerId)
  }
}
