import { Device, types as mediasoupTypes } from 'mediasoup-client'

export function usePartyHost() {
  const config = useRuntimeConfig()
  const player = usePlayerStore()

  const isActive = ref(false)
  const sessionId = ref<string | null>(null)
  const listenerCount = ref(0)
  const inviteUrl = ref('')
  const error = ref<string | null>(null)
  const isConnecting = ref(false)

  let ws: WebSocket | null = null
  let device: Device | null = null
  let sendTransport: mediasoupTypes.Transport | null = null
  let producer: mediasoupTypes.Producer | null = null
  let audioContext: AudioContext | null = null
  let mediaStream: MediaStream | null = null
  let positionInterval: ReturnType<typeof setInterval> | null = null
  let pendingResolves = new Map<string, (data: any) => void>()

  function getWsUrl(): string {
    const partyUrl = config.public.partyUrl
    if (!partyUrl) {
      throw new Error('PARTY_URL not configured')
    }
    const url = new URL(partyUrl)
    const wsProtocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${url.host}/_ws`
  }

  function sendMsg(type: string, data: Record<string, unknown> = {}) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }))
    }
  }

  function waitForMessage(type: string): Promise<any> {
    return new Promise((resolve) => {
      pendingResolves.set(type, resolve)
    })
  }

  function captureAudio(): MediaStream {
    const audioEl = player.getAudioElement()
    if (!audioEl) throw new Error('No audio element available')

    audioContext = new AudioContext()
    const source = audioContext.createMediaElementSource(audioEl)
    const dest = audioContext.createMediaStreamDestination()

    source.connect(dest)
    source.connect(audioContext.destination)

    mediaStream = dest.stream
    return mediaStream
  }

  async function startSession() {
    if (isActive.value) return
    isConnecting.value = true
    error.value = null

    try {
      const wsUrl = getWsUrl()
      ws = new WebSocket(wsUrl)

      await new Promise<void>((resolve, reject) => {
        ws!.onopen = () => resolve()
        ws!.onerror = () => reject(new Error('WebSocket connection failed'))
        setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000)
      })

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        const resolver = pendingResolves.get(msg.type)
        if (resolver) {
          pendingResolves.delete(msg.type)
          resolver(msg)
        }

        if (msg.type === 'listenerCount') {
          listenerCount.value = msg.count
        }
        else if (msg.type === 'error') {
          console.error('[party-host] Server error:', msg.message)
        }
      }

      ws.onclose = () => {
        if (isActive.value) {
          cleanup()
        }
      }

      // 1. Create session
      sendMsg('createSession')
      const sessionMsg = await waitForMessage('sessionCreated')
      sessionId.value = sessionMsg.sessionId

      const partyUrl = config.public.partyUrl
      inviteUrl.value = partyUrl || window.location.origin

      // 2. Load device
      device = new Device()
      await device.load({ routerRtpCapabilities: sessionMsg.routerRtpCapabilities })

      // 3. Create producer transport
      sendMsg('createProducerTransport')
      const transportMsg = await waitForMessage('producerTransportCreated')

      sendTransport = device.createSendTransport({
        id: transportMsg.id,
        iceParameters: transportMsg.iceParameters,
        iceCandidates: transportMsg.iceCandidates,
        dtlsParameters: transportMsg.dtlsParameters,
      })

      sendTransport.on('connect', ({ dtlsParameters }: any, callback: () => void, errback: (err: Error) => void) => {
        sendMsg('connectTransport', { dtlsParameters })
        waitForMessage('transportConnected').then(() => callback()).catch(errback)
      })

      sendTransport.on('produce', ({ kind, rtpParameters }: any, callback: (params: { id: string }) => void, errback: (err: Error) => void) => {
        sendMsg('produce', { kind, rtpParameters })
        waitForMessage('produced')
          .then((msg: any) => callback({ id: msg.producerId }))
          .catch(errback)
      })

      // 4. Capture audio and produce
      const stream = captureAudio()
      const audioTrack = stream.getAudioTracks()[0]

      producer = await sendTransport.produce({ track: audioTrack })

      // 5. Start metadata sync
      startMetadataSync()

      isActive.value = true
      isConnecting.value = false

      // Send initial track state if playing
      if (player.currentTrack) {
        sendNowPlaying()
      }
    }
    catch (err) {
      error.value = (err as Error).message
      isConnecting.value = false
      cleanup()
    }
  }

  function sendNowPlaying() {
    if (!player.currentTrack) return
    sendMsg('nowPlaying', {
      track: {
        id: player.currentTrack.id,
        title: player.currentTrack.title,
        artist: player.currentTrack.artist,
        artistSlug: player.currentTrack.artistSlug,
        releaseTitle: player.currentTrack.album,
        releaseId: player.currentTrack.localReleaseId,
        coverPath: player.currentTrack.releaseImageUrl || player.currentTrack.releaseImage,
        duration: player.currentTrack.duration,
      },
    })
  }

  function startMetadataSync() {
    // Watch for track changes
    watch(() => player.currentTrack, (newTrack, oldTrack) => {
      if (newTrack && newTrack.id !== oldTrack?.id) {
        sendNowPlaying()
      }
    })

    // Watch for play/pause
    watch(() => player.isPlaying, (playing) => {
      if (playing) {
        sendMsg('resume')
      }
      else {
        sendMsg('pause')
      }
    })

    // Periodic position sync
    positionInterval = setInterval(() => {
      if (isActive.value) {
        sendMsg('position', {
          currentTime: player.currentTime,
          duration: player.duration,
        })
      }
    }, 1000)
  }

  function cleanup() {
    if (positionInterval) {
      clearInterval(positionInterval)
      positionInterval = null
    }

    producer?.close()
    producer = null
    sendTransport?.close()
    sendTransport = null
    device = null

    if (audioContext) {
      audioContext.close().catch(() => {})
      audioContext = null
    }
    mediaStream = null

    if (ws) {
      ws.close()
      ws = null
    }

    pendingResolves.clear()
    isActive.value = false
    sessionId.value = null
    listenerCount.value = 0
    inviteUrl.value = ''
    isConnecting.value = false
  }

  async function endSession() {
    if (ws?.readyState === WebSocket.OPEN) {
      sendMsg('endSession')
    }
    cleanup()
  }

  onBeforeUnmount(() => {
    if (isActive.value) {
      endSession()
    }
  })

  return {
    isActive: readonly(isActive),
    sessionId: readonly(sessionId),
    listenerCount: readonly(listenerCount),
    inviteUrl: readonly(inviteUrl),
    error: readonly(error),
    isConnecting: readonly(isConnecting),
    startSession,
    endSession,
  }
}
