import { defineStore } from 'pinia'

interface PartyHostState {
  isActive: boolean
  sessionId: string | null
  listenerCount: number
  inviteUrl: string
  error: string | null
  isConnecting: boolean
}

// Module-level storage for connection objects (not reactive)
let ws: WebSocket | null = null
let device: any = null
let sendTransport: any = null
let producer: any = null
let audioContext: AudioContext | null = null
let mediaStream: MediaStream | null = null
let positionInterval: ReturnType<typeof setInterval> | null = null
let pendingResolves = new Map<string, (data: any) => void>()

export const usePartyHostStore = defineStore('partyHost', {
  state: (): PartyHostState => ({
    isActive: false,
    sessionId: null,
    listenerCount: 0,
    inviteUrl: '',
    error: null,
    isConnecting: false,
  }),

  actions: {
    // Expose getters/setters for connection objects
    getWs() { return ws },
    setWs(val: WebSocket | null) { ws = val },
    getDevice() { return device },
    setDevice(val: any) { device = val },
    getSendTransport() { return sendTransport },
    setSendTransport(val: any) { sendTransport = val },
    getProducer() { return producer },
    setProducer(val: any) { producer = val },
    getAudioContext() { return audioContext },
    setAudioContext(val: AudioContext | null) { audioContext = val },
    getMediaStream() { return mediaStream },
    setMediaStream(val: MediaStream | null) { mediaStream = val },
    getPositionInterval() { return positionInterval },
    setPositionInterval(val: ReturnType<typeof setInterval> | null) { positionInterval = val },
    getPendingResolves() { return pendingResolves },

    cleanup() {
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
      this.isActive = false
      this.sessionId = null
      this.listenerCount = 0
      this.inviteUrl = ''
      this.isConnecting = false
    },
  },

  persist: {
    storage: import.meta.client ? sessionStorage : undefined,
    paths: ['isActive', 'sessionId', 'listenerCount', 'inviteUrl'],
  },
})
