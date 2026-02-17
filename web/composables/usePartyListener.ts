import { Device, types as mediasoupTypes } from 'mediasoup-client'

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
  const isConnected = ref(false)
  const currentTrack = ref<PartyTrackMeta | null>(null)
  const isPlaying = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const error = ref<string | null>(null)
  const isReconnecting = ref(false)

  let ws: WebSocket | null = null
  let device: Device | null = null
  let recvTransport: mediasoupTypes.Transport | null = null
  let consumer: mediasoupTypes.Consumer | null = null
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

  async function connect() {
    if (isConnected.value) return
    error.value = null

    try {
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

      // 2. Load device
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

      // 4. Consume audio
      sendMsg('consume', { rtpCapabilities: device.rtpCapabilities })
      const consumeMsg = await waitForMessage('consumed')

      consumer = await recvTransport.consume({
        id: consumeMsg.consumerId,
        producerId: consumeMsg.producerId,
        kind: consumeMsg.kind,
        rtpParameters: consumeMsg.rtpParameters,
      })

      // 5. Attach audio
      const audio = getAudioElement()
      const stream = new MediaStream([consumer.track])
      audio.srcObject = stream

      // 6. Resume consumer on server
      sendMsg('resumeConsumer')
      await waitForMessage('consumerResumed')

      // Start local position interpolation
      startPositionInterpolation()

      isConnected.value = true
      isReconnecting.value = false

      // Auto-play (needs user interaction first)
      if (isPlaying.value) {
        audio.play().catch(() => {
          // Browser requires user gesture for autoplay
        })
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
        currentTrack.value = msg.track as PartyTrackMeta
        isPlaying.value = true
        currentTime.value = 0
        lastPositionUpdate = Date.now()
        break
      case 'pause':
        isPlaying.value = false
        audioEl?.pause()
        break
      case 'resume':
        isPlaying.value = true
        lastPositionUpdate = Date.now()
        audioEl?.play().catch(() => {})
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
        isPlaying.value = false
        break
      case 'producerAvailable':
        // Re-consume if we had a previous consumer that was closed
        if (isConnected.value && !consumer) {
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
      sendMsg('consume', { rtpCapabilities: device.rtpCapabilities })
      const consumeMsg = await waitForMessage('consumed')
      consumer = await recvTransport.consume({
        id: consumeMsg.consumerId,
        producerId: consumeMsg.producerId,
        kind: consumeMsg.kind,
        rtpParameters: consumeMsg.rtpParameters,
      })
      const audio = getAudioElement()
      audio.srcObject = new MediaStream([consumer.track])
      sendMsg('resumeConsumer')
      await waitForMessage('consumerResumed')
      if (isPlaying.value) {
        audio.play().catch(() => {})
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
