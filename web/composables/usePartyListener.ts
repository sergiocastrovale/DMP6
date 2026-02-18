interface PartyTrackMeta {
  id: string
  title: string
  artist: string
  artistSlug?: string
  releaseTitle?: string
  releaseId?: string
  coverPath?: string
  duration?: number
}

export function usePartyListener() {
  // Only run on client
  if (import.meta.server) {
    return {
      isConnected: ref(false),
      currentTrack: ref<PartyTrackMeta | null>(null),
      isPlaying: ref(false),
      currentTime: ref(0),
      duration: ref(0),
      error: ref<string | null>(null),
      isReconnecting: ref(false),
      connect: async () => {},
      disconnect: () => {},
      togglePlay: () => {},
      setVolume: () => {},
      toggleMute: () => {},
    }
  }

  const isConnected = ref(false)
  const currentTrack = ref<PartyTrackMeta | null>(null)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const error = ref<string | null>(null)
  const isReconnecting = ref(false)

  let ws: WebSocket | null = null
  let device: any = null
  let recvTransport: any = null
  let consumer: any = null
  let audioEl: HTMLAudioElement | null = null
  let pendingResolves = new Map<string, (data: any) => void>()
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let positionUpdateTimer: ReturnType<typeof setInterval> | null = null
  let lastPositionUpdate = 0

  function sendMsg(type: string, data: Record<string, unknown> = {}) {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }))
    }
  }

  function waitForMessage(type: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingResolves.delete(type)
        reject(new Error(`Timeout waiting for ${type}`))
      }, 15000)
      pendingResolves.set(type, (data) => {
        clearTimeout(timeout)
        resolve(data)
      })
    })
  }

  function getAudioElement(): HTMLAudioElement {
    if (!audioEl) {
      audioEl = new Audio()
      audioEl.autoplay = false
    }
    return audioEl
  }

  async function consumeAudio() {
    if (!device || !recvTransport) {
      throw new Error('Device or transport not ready')
    }

    console.log('[party-listener] Requesting audio consumption...')
    sendMsg('consume', { rtpCapabilities: device.rtpCapabilities })
    const consumeMsg = await waitForMessage('consumed')
    console.log('[party-listener] Consume response received:', consumeMsg)

    consumer = await recvTransport.consume({
      id: consumeMsg.consumerId,
      producerId: consumeMsg.producerId,
      kind: consumeMsg.kind,
      rtpParameters: consumeMsg.rtpParameters,
    })
    console.log('[party-listener] Consumer created, track:', consumer.track)

    // Attach audio
    const audio = getAudioElement()
    const stream = new MediaStream([consumer.track])
    audio.srcObject = stream
    console.log('[party-listener] Audio stream attached to element')

    // Resume consumer on server
    sendMsg('resumeConsumer')
    await waitForMessage('consumerResumed')
    console.log('[party-listener] Consumer resumed on server')
  }

  async function connect() {
    if (isConnected.value) return
    error.value = null

    try {
      console.log('[party-listener] Connecting to party session...')
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const wsUrl = `${wsProtocol}//${window.location.host}/_ws`
      ws = new WebSocket(wsUrl)

      await new Promise<void>((resolve, reject) => {
        ws!.onopen = () => resolve()
        ws!.onerror = () => reject(new Error('WebSocket connection failed'))
        setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000)
      })

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        handleMessage(msg)
      }

      ws.onclose = () => {
        if (isConnected.value) {
          isConnected.value = false
          scheduleReconnect()
        }
      }

      // 1. Join session
      sendMsg('join')
      const joinMsg = await waitForMessage('joined')

      if (joinMsg.currentTrack) {
        currentTrack.value = joinMsg.currentTrack
        isPlaying.value = joinMsg.isPlaying
        currentTime.value = joinMsg.currentTime
        duration.value = joinMsg.duration
      }

      // 2. Load device (dynamic import for client-only)
      const { Device } = await import('mediasoup-client')
      device = new Device()
      await device.load({ routerRtpCapabilities: joinMsg.routerRtpCapabilities })

      // 3. Create consumer transport
      sendMsg('createConsumerTransport')
      const transportMsg = await waitForMessage('consumerTransportCreated')

      recvTransport = device.createRecvTransport({
        id: transportMsg.id,
        iceParameters: transportMsg.iceParameters,
        iceCandidates: transportMsg.iceCandidates,
        dtlsParameters: transportMsg.dtlsParameters,
      })

      recvTransport.on('connect', ({ dtlsParameters }: any, callback: () => void, errback: (err: Error) => void) => {
        sendMsg('connectTransport', { dtlsParameters })
        waitForMessage('transportConnected').then(() => callback()).catch(errback)
      })

      // Start local position interpolation
      startPositionInterpolation()

      isConnected.value = true
      isReconnecting.value = false
      console.log('[party-listener] Connected successfully!')

      // 4. Try to consume audio if producer is available
      // If not available, we'll consume when we receive 'producerAvailable' message
      try {
        console.log('[party-listener] Attempting initial audio consumption...')
        await consumeAudio()
        console.log('[party-listener] Initial audio consumption successful')
        
        // Auto-play (needs user interaction first)
        if (isPlaying.value) {
          console.log('[party-listener] Auto-playing audio...')
          const audio = getAudioElement()
          audio.play().catch((err) => {
            console.warn('[party-listener] Auto-play failed (user interaction required):', err)
          })
        }
      }
      catch (err) {
        console.log('[party-listener] No producer available yet, waiting for host to start playing...')
        // This is expected if host hasn't started playing yet
        // We'll consume when we receive 'producerAvailable' message
      }
    }
    catch (err) {
      error.value = (err as Error).message
      cleanup(false)
      scheduleReconnect()
    }
  }

  function handleMessage(msg: Record<string, unknown>) {
    const resolver = pendingResolves.get(msg.type as string)
    if (resolver) {
      pendingResolves.delete(msg.type as string)
      resolver(msg)
      return
    }

    switch (msg.type) {
      case 'nowPlaying':
        console.log('[party-listener] Now playing:', (msg.track as PartyTrackMeta)?.title)
        currentTrack.value = msg.track as PartyTrackMeta
        isPlaying.value = true
        currentTime.value = 0
        lastPositionUpdate = Date.now()
        if (audioEl) {
          audioEl.play().catch((err) => {
            console.warn('[party-listener] Failed to play on nowPlaying:', err)
          })
        }
        break
      case 'pause':
        isPlaying.value = false
        audioEl?.pause()
        break
      case 'resume':
        console.log('[party-listener] Host resumed playback')
        isPlaying.value = true
        lastPositionUpdate = Date.now()
        if (audioEl) {
          audioEl.play().catch((err) => {
            console.warn('[party-listener] Failed to play on resume:', err)
          })
        }
        break
      case 'position':
        currentTime.value = msg.currentTime as number
        duration.value = msg.duration as number
        lastPositionUpdate = Date.now()
        break
      case 'sessionEnded':
        cleanup(false)
        currentTrack.value = null
        isPlaying.value = false
        currentTime.value = 0
        duration.value = 0
        break
      case 'producerClosed':
        console.log('[party-listener] Producer closed')
        isPlaying.value = false
        break
      case 'producerAvailable':
        console.log('[party-listener] Producer available, consumer exists:', !!consumer)
        // Re-consume if we had a previous consumer that was closed or if we never had one
        if (isConnected.value && (!consumer || consumer.closed)) {
          console.log('[party-listener] Re-consuming audio...')
          reConsume()
        }
        break
      case 'error':
        console.error('[party-listener] Server error:', msg.message)
        break
    }
  }

  async function reConsume() {
    if (!device || !recvTransport) return
    try {
      await consumeAudio()
      if (isPlaying.value) {
        const audio = getAudioElement()
        audio.play().catch((err) => {
          console.warn('[party-listener] Failed to auto-play after re-consume:', err)
        })
      }
    }
    catch (err) {
      console.error('[party-listener] Failed to re-consume:', err)
    }
  }

  function startPositionInterpolation() {
    if (positionUpdateTimer) clearInterval(positionUpdateTimer)
    positionUpdateTimer = setInterval(() => {
      if (isPlaying.value && lastPositionUpdate > 0) {
        const elapsed = (Date.now() - lastPositionUpdate) / 1000
        currentTime.value = currentTime.value + elapsed
        lastPositionUpdate = Date.now()
      }
    }, 250)
  }

  function scheduleReconnect() {
    if (reconnectTimeout) return
    isReconnecting.value = true
    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = null
      connect()
    }, 3000)
  }

  function togglePlay() {
    const audio = getAudioElement()
    if (audio.paused) {
      audio.play().catch(() => {})
    }
    else {
      audio.pause()
    }
  }

  function setVolume(val: number) {
    const audio = getAudioElement()
    audio.volume = val
  }

  function toggleMute(muted: boolean) {
    const audio = getAudioElement()
    audio.muted = muted
  }

  function cleanup(clearState = true) {
    if (positionUpdateTimer) {
      clearInterval(positionUpdateTimer)
      positionUpdateTimer = null
    }

    consumer?.close()
    consumer = null
    recvTransport?.close()
    recvTransport = null
    device = null

    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }

    pendingResolves.clear()
    isConnected.value = false

    if (clearState) {
      currentTrack.value = null
      isPlaying.value = false
      currentTime.value = 0
      duration.value = 0
    }
  }

  function disconnect() {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    isReconnecting.value = false
    cleanup()
  }

  onBeforeUnmount(() => {
    disconnect()
  })

  return {
    isConnected: readonly(isConnected),
    currentTrack: readonly(currentTrack),
    isPlaying: readonly(isPlaying),
    currentTime: readonly(currentTime),
    duration: readonly(duration),
    error: readonly(error),
    isReconnecting: readonly(isReconnecting),
    connect,
    disconnect,
    togglePlay,
    setVolume,
    toggleMute,
  }
}
