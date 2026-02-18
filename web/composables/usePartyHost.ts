export function usePartyHost() {
  // Only run on client
  if (import.meta.server) {
    return {
      isActive: computed(() => false),
      sessionId: computed(() => null),
      listenerCount: computed(() => 0),
      inviteUrl: computed(() => ''),
      error: computed(() => null),
      isConnecting: computed(() => false),
      startSession: async () => {},
      endSession: () => {},
    }
  }

  const config = useRuntimeConfig()
  const player = usePlayerStore()
  const store = usePartyHostStore()

  // Use store getters/setters for connection objects
  const getWs = () => store.getWs()
  const setWs = (val: WebSocket | null) => store.setWs(val)
  const getDevice = () => store.getDevice()
  const setDevice = (val: any) => store.setDevice(val)
  const getSendTransport = () => store.getSendTransport()
  const setSendTransport = (val: any) => store.setSendTransport(val)
  const getProducer = () => store.getProducer()
  const setProducer = (val: any) => store.setProducer(val)
  const getAudioContext = () => store.getAudioContext()
  const setAudioContext = (val: AudioContext | null) => store.setAudioContext(val)
  const getMediaStream = () => store.getMediaStream()
  const setMediaStream = (val: MediaStream | null) => store.setMediaStream(val)
  const getPositionInterval = () => store.getPositionInterval()
  const setPositionInterval = (val: ReturnType<typeof setInterval> | null) => store.setPositionInterval(val)
  const getPendingResolves = () => store.getPendingResolves()

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
    const ws = getWs()
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, ...data }))
    }
  }

  function waitForMessage(type: string): Promise<any> {
    return new Promise((resolve) => {
      getPendingResolves().set(type, resolve)
    })
  }

  function captureAudio(): MediaStream {
    // Check if we already have a valid audio context and stream
    const existingContext = getAudioContext()
    const existingStream = getMediaStream()
    
    if (existingContext && existingStream) {
      console.log('[party-host] Reusing existing audio capture')
      return existingStream
    }

    const audioEl = player.getAudioElement()
    if (!audioEl) throw new Error('No audio element available')

    console.log('[party-host] Creating new audio capture')
    const audioContext = new AudioContext()
    setAudioContext(audioContext)
    
    const source = audioContext.createMediaElementSource(audioEl)
    const dest = audioContext.createMediaStreamDestination()

    source.connect(dest)
    source.connect(audioContext.destination)

    const mediaStream = dest.stream
    setMediaStream(mediaStream)
    return mediaStream
  }

  async function ensureProducer() {
    const existingProducer = getProducer()
    if (existingProducer && !existingProducer.closed) {
      console.log('[party-host] Producer already active')
      return
    }

    const sendTransport = getSendTransport()
    if (!sendTransport) {
      console.error('[party-host] No send transport available')
      return
    }

    try {
      console.log('[party-host] Creating new producer')
      const stream = captureAudio()
      const audioTrack = stream.getAudioTracks()[0]
      
      if (!audioTrack) {
        throw new Error('No audio track available')
      }

      const producer = await sendTransport.produce({ track: audioTrack })
      setProducer(producer)
      console.log('[party-host] Producer created successfully')
    }
    catch (err) {
      console.error('[party-host] Failed to create producer:', err)
      throw err
    }
  }

  async function startSession() {
    if (store.isActive) return
    store.isConnecting = true
    store.error = null

    try {
      const wsUrl = getWsUrl()
      const ws = new WebSocket(wsUrl); setWs(ws)

      await new Promise<void>((resolve, reject) => {
        ws!.onopen = () => resolve()
        ws!.onerror = () => reject(new Error('WebSocket connection failed'))
        setTimeout(() => reject(new Error('WebSocket connection timeout')), 10000)
      })

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        const resolver = getPendingResolves().get(msg.type)
        if (resolver) {
          getPendingResolves().delete(msg.type)
          resolver(msg)
        }

        if (msg.type === 'listenerCount') {
          store.listenerCount = msg.count
        }
        else if (msg.type === 'error') {
          console.error('[party-host] Server error:', msg.message)
        }
      }

      ws.onclose = () => {
        if (store.isActive) {
          cleanup()
        }
      }

      // 1. Create session
      sendMsg('createSession')
      const sessionMsg = await waitForMessage('sessionCreated')
      store.sessionId = sessionMsg.sessionId

      const partyUrl = config.public.partyUrl
      store.inviteUrl = partyUrl || window.location.origin

      // 2. Load device (dynamic import for client-only)
      const { Device } = await import('mediasoup-client')
      const device = new Device(); setDevice(device)
      await device.load({ routerRtpCapabilities: sessionMsg.routerRtpCapabilities })

      // 3. Create producer transport
      sendMsg('createProducerTransport')
      const transportMsg = await waitForMessage('producerTransportCreated')

      const sendTransport = device.createSendTransport({
        id: transportMsg.id,
        iceParameters: transportMsg.iceParameters,
        iceCandidates: transportMsg.iceCandidates,
        dtlsParameters: transportMsg.dtlsParameters,
      })
      setSendTransport(sendTransport)

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

      // 4. Start metadata sync (before creating producer)
      startMetadataSync()

      // 5. Create producer if audio is playing
      if (player.isPlaying && player.currentTrack) {
        await ensureProducer()
      }

      store.isActive = true
      store.isConnecting = false

      // Send initial track state if playing
      if (player.currentTrack) {
        sendNowPlaying()
      }
    }
    catch (err) {
      store.error = (err as Error).message
      store.isConnecting = false
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

    // Watch for play/pause and ensure producer
    watch(() => player.isPlaying, async (playing) => {
      if (playing) {
        sendMsg('resume')
        
        // When playback starts, ensure we have an active producer
        if (player.currentTrack) {
          try {
            await ensureProducer()
          }
          catch (err) {
            console.error('[party-host] Failed to ensure producer on play:', err)
            store.error = 'Failed to start audio streaming'
          }
        }
      }
      else {
        sendMsg('pause')
      }
    })

    // Periodic position sync
    const interval = setInterval(() => {
      if (store.isActive) {
        sendMsg('position', {
          currentTime: player.currentTime,
          duration: player.duration,
        })
      }
    }, 1000)
    setPositionInterval(interval)
  }

  function cleanup() {
    store.cleanup()
  }

  async function endSession() {
    const ws = getWs()
    if (ws?.readyState === WebSocket.OPEN) {
      sendMsg('endSession')
    }
    cleanup()
  }

  // On mount, check if we need to reconnect
  onMounted(async () => {
    const ws = getWs()
    const isConnected = ws?.readyState === WebSocket.OPEN
    
    if (store.isActive && !isConnected) {
      console.log('[party-host] Session active but disconnected, reconnecting...')
      // Session was active but connection lost (e.g., page refresh/navigation)
      // Reset state and restart session
      const wasActive = store.isActive
      store.cleanup()
      
      if (wasActive) {
        try {
          await startSession()
        }
        catch (err) {
          console.error('[party-host] Failed to reconnect session:', err)
          store.error = 'Failed to reconnect. Please start a new session.'
        }
      }
    }
    else if (store.isActive && player.isPlaying && player.currentTrack) {
      // Connected but need to ensure producer
      console.log('[party-host] Session active on mount, ensuring producer')
      ensureProducer().catch((err) => {
        console.error('[party-host] Failed to restore producer on mount:', err)
      })
    }
  })

  onBeforeUnmount(() => {
    // Don't cleanup on unmount - let the session persist
  })

  return {
    isActive: computed(() => store.isActive),
    sessionId: computed(() => store.sessionId),
    listenerCount: computed(() => store.listenerCount),
    inviteUrl: computed(() => store.inviteUrl),
    error: computed(() => store.error),
    isConnecting: computed(() => store.isConnecting),
    startSession,
    endSession,
  }
}
