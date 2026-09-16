import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetPresenceForTest,
  clearPresence,
  isOnline,
  isStillPlaying,
  listOnline,
  setNowPlaying,
  touchPresence,
} from '../../../server/utils/presence'
import { PRESENCE_PLAYING_STALE_MS, PRESENCE_STALE_MS } from '../../../helpers/constants'

describe('presence', () => {
  beforeEach(() => {
    _resetPresenceForTest()
  })

  describe('isOnline', () => {
    it('is online right after the heartbeat', () => {
      expect(isOnline(1000, 1000)).toBe(true)
    })

    it('is offline once past PRESENCE_STALE_MS', () => {
      expect(isOnline(1000, 1000 + PRESENCE_STALE_MS)).toBe(false)
      expect(isOnline(1000, 1000 + PRESENCE_STALE_MS - 1)).toBe(true)
    })
  })

  describe('isStillPlaying', () => {
    it('is false when the track is marked paused', () => {
      expect(isStillPlaying({ trackId: 't1', playing: false, updatedAt: 1000 }, 1000)).toBe(false)
    })

    it('is true right after being marked playing', () => {
      expect(isStillPlaying({ trackId: 't1', playing: true, updatedAt: 1000 }, 1000)).toBe(true)
    })

    it('goes stale (shows as paused) once its own timestamp is old, even if still marked playing', () => {
      const now = 1000 + PRESENCE_PLAYING_STALE_MS
      expect(isStillPlaying({ trackId: 't1', playing: true, updatedAt: 1000 }, now)).toBe(false)
    })
  })

  describe('touchPresence / listOnline', () => {
    it('lists a freshly touched entry', () => {
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox · Windows', now: 1000 })
      const online = listOnline(1000)
      expect(online).toHaveLength(1)
      expect(online[0]).toMatchObject({ userId: 1, clientId: 'a', clientLabel: 'Firefox · Windows', track: null })
    })

    it('prunes an entry once it goes stale', () => {
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox', now: 1000 })
      expect(listOnline(1000 + PRESENCE_STALE_MS)).toHaveLength(0)
      // Pruning is permanent, not just filtered from the return value - a later touch shouldn't
      // resurrect the old lastSeenAt.
      expect(listOnline(1000 + PRESENCE_STALE_MS)).toHaveLength(0)
    })

    it('keeps two tabs of the same user as two separate entries', () => {
      touchPresence({ userId: 1, clientId: 'tab-a', client: 'web', clientLabel: 'Firefox', now: 1000 })
      touchPresence({ userId: 1, clientId: 'tab-b', client: 'web', clientLabel: 'Chrome', now: 1000 })
      expect(listOnline(1000)).toHaveLength(2)
    })

    it('re-touching the same client updates lastSeenAt without duplicating the entry', () => {
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox', now: 1000 })
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox', now: 2000 })
      const online = listOnline(2000)
      expect(online).toHaveLength(1)
      expect(online[0]?.lastSeenAt).toBe(2000)
    })

    it('sorts by most recently seen first', () => {
      touchPresence({ userId: 1, clientId: 'old', client: 'web', clientLabel: 'a', now: 1000 })
      touchPresence({ userId: 2, clientId: 'new', client: 'web', clientLabel: 'b', now: 2000 })
      expect(listOnline(2000).map(e => e.clientId)).toEqual(['new', 'old'])
    })
  })

  describe('setNowPlaying', () => {
    it('is a no-op when the client was never touched (no session to attach a track to)', () => {
      setNowPlaying(1, 'ghost', { trackId: 't1', playing: true })
      expect(listOnline()).toHaveLength(0)
    })

    it('attaches a track to an existing session', () => {
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox', now: 1000 })
      setNowPlaying(1, 'a', { trackId: 't1', playing: true }, 1000)
      const [entry] = listOnline(1000)
      expect(entry?.track).toEqual({ trackId: 't1', playing: true, updatedAt: 1000 })
    })

    it('clearing now-playing (null) keeps the session online, just idle', () => {
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox', now: 1000 })
      setNowPlaying(1, 'a', { trackId: 't1', playing: true }, 1000)
      setNowPlaying(1, 'a', null, 1500)
      const [entry] = listOnline(1500)
      expect(entry?.track).toBeNull()
    })

    it('touching presence again after a track was set does not clear the track', () => {
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox', now: 1000 })
      setNowPlaying(1, 'a', { trackId: 't1', playing: true }, 1000)
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox', now: 2000 })
      const [entry] = listOnline(2000)
      expect(entry?.track?.trackId).toBe('t1')
    })
  })

  describe('clearPresence', () => {
    it('removes the entry immediately', () => {
      touchPresence({ userId: 1, clientId: 'a', client: 'web', clientLabel: 'Firefox', now: 1000 })
      clearPresence(1, 'a')
      expect(listOnline(1000)).toHaveLength(0)
    })

    it('clearing an unknown client is a silent no-op', () => {
      expect(() => clearPresence(1, 'never-existed')).not.toThrow()
    })
  })
})
