import { getPartySession } from '../../utils/party'

export default defineEventHandler(() => {
  const session = getPartySession()

  if (!session) {
    return {
      active: false,
      sessionId: null,
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      listenerCount: 0,
    }
  }

  return {
    active: true,
    sessionId: session.id,
    currentTrack: session.currentTrack,
    isPlaying: session.isPlaying,
    currentTime: session.currentTime,
    duration: session.duration,
    listenerCount: session.listeners.size,
  }
})
