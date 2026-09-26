import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  callLastFm: vi.fn(),
  describe: vi.fn(),
  configured: vi.fn(),
  settings: vi.fn(),
  session: vi.fn(),
  log: vi.fn(),
}))

vi.mock('~/server/utils/prisma', () => ({ prisma: { localReleaseTrack: { findUnique: mocks.findUnique } } }))
vi.mock('~/server/utils/settingsCache', () => ({ getCachedSettings: mocks.settings }))
vi.mock('~/server/utils/lastfm', () => ({ callLastFm: mocks.callLastFm, describeLastfmProblem: mocks.describe, isLastfmConfigured: mocks.configured }))
vi.mock('~/server/utils/lastfmSessions', () => ({ getUserLastfmSession: mocks.session }))
vi.mock('~/server/utils/monitorLog', () => ({ monitorLog: mocks.log }))

const { scrobbleTrack, scrobbleInBackground, lastfmCredentialsFor } = await import('../../../server/utils/scrobble')

const track = { title: 'Song', artist: 'Band', album: 'Album', duration: 200, trackNumber: 3 }

describe('scrobbleTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.settings.mockReturnValue({ lastfmApiKey: 'k', lastfmSecret: 's' })
    mocks.session.mockResolvedValue({ sessionKey: 'sk', username: 'alice' })
    mocks.configured.mockReturnValue(true)
    mocks.findUnique.mockResolvedValue(track)
    mocks.callLastFm.mockResolvedValue({})
    mocks.describe.mockReturnValue(null)
  })

  it('sends the track with the listen start time in seconds', async () => {
    expect(await scrobbleTrack(7, 't1', 1_700_000_123_456)).toBe(true)
    expect(mocks.callLastFm).toHaveBeenCalledWith('track.scrobble', {
      'artist[0]': 'Band', 'track[0]': 'Song', 'timestamp[0]': '1700000123', 'album[0]': 'Album', 'duration[0]': '200', 'trackNumber[0]': '3',
    }, { lastfmApiKey: 'k', lastfmSecret: 's', lastfmSessionKey: 'sk' })
  })

  it("signs with the listener's own session, looked up by their id", async () => {
    await scrobbleTrack(7, 't1', 1)
    expect(mocks.session).toHaveBeenCalledWith(7)
  })

  it('does nothing for a listener who has not connected Last.fm', async () => {
    mocks.session.mockResolvedValue(null)
    expect(await scrobbleTrack(7, 't1', 1)).toBe(false)
    expect(mocks.callLastFm).not.toHaveBeenCalled()
  })

  it('does nothing when Last.fm is not configured', async () => {
    mocks.configured.mockReturnValue(false)
    expect(await scrobbleTrack(7, 't1', 1)).toBe(false)
    expect(mocks.callLastFm).not.toHaveBeenCalled()
  })

  it('skips a track without a title or artist', async () => {
    mocks.findUnique.mockResolvedValue({ ...track, artist: null })
    expect(await scrobbleTrack(7, 't1', 1)).toBe(false)
    expect(mocks.callLastFm).not.toHaveBeenCalled()
  })

  it('logs a problem Last.fm reports and returns false', async () => {
    mocks.describe.mockReturnValue('timestamp too old')
    expect(await scrobbleTrack(7, 't1', 1)).toBe(false)
    expect(mocks.log).toHaveBeenCalledWith('warn', expect.stringContaining('timestamp too old'))
  })
})

describe('lastfmCredentialsFor', () => {
  it('is null without a session and merges the application key with the user session otherwise', async () => {
    mocks.settings.mockReturnValue({ lastfmApiKey: 'k', lastfmSecret: 's' })
    mocks.configured.mockReturnValue(true)
    mocks.session.mockResolvedValue(null)
    expect(await lastfmCredentialsFor(1)).toBeNull()
    mocks.session.mockResolvedValue({ sessionKey: 'sk', username: 'a' })
    expect(await lastfmCredentialsFor(1)).toEqual({ lastfmApiKey: 'k', lastfmSecret: 's', lastfmSessionKey: 'sk' })
  })
})

describe('scrobbleInBackground', () => {
  it('never throws, even when the send fails', async () => {
    mocks.settings.mockReturnValue({})
    mocks.session.mockResolvedValue({ sessionKey: 'sk', username: 'a' })
    mocks.configured.mockReturnValue(true)
    mocks.findUnique.mockRejectedValue(new Error('db down'))
    expect(() => scrobbleInBackground(7, 't1', 1)).not.toThrow()
    await vi.waitFor(() => expect(mocks.log).toHaveBeenCalledWith('warn', expect.stringContaining('db down')))
  })
})
