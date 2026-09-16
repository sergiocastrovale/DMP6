import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import UsersLive from '../../../components/settings/UsersLive.vue'
import { USERS_LIVE_REFRESH_MS } from '../../../helpers/constants'
import type { UserPresence } from '../../../types/auth'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.stubGlobal('$fetch', fetchMock)

const withTrack = (overrides: Partial<UserPresence['sessions'][number]['nowPlaying']> = {}): UserPresence[] => [{
  userId: 1,
  username: 'kp',
  sessions: [{
    clientId: 'tab-a',
    client: 'web',
    clientLabel: 'Firefox · Windows',
    lastSeenAt: new Date().toISOString(),
    nowPlaying: {
      trackId: 't1',
      title: 'Paranoid Android',
      album: 'OK Computer',
      releaseId: 'r1',
      artist: 'Radiohead',
      artistSlug: 'radiohead',
      image: null,
      imageUrl: null,
      playing: true,
      ...overrides,
    },
  }],
}]

describe('settings/UsersLive.vue', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows "No one connected" when nobody is online', async () => {
    fetchMock.mockResolvedValueOnce([])
    const wrapper = await mountSuspended(UsersLive)
    expect(wrapper.text()).toContain('No one connected')
  })

  it('renders an online session with its now-playing track/artist/album', async () => {
    fetchMock.mockResolvedValueOnce(withTrack())
    const wrapper = await mountSuspended(UsersLive)

    expect(wrapper.text()).toContain('kp')
    expect(wrapper.text()).toContain('Firefox · Windows')
    expect(wrapper.text()).toContain('Paranoid Android')
    expect(wrapper.text()).toContain('Radiohead')
    expect(wrapper.text()).toContain('OK Computer')
    expect(wrapper.find('a[href="/artist/radiohead"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Idle')
  })

  it('shows Idle for an online session with no track playing', async () => {
    const presence: UserPresence[] = [{
      userId: 1,
      username: 'kp',
      sessions: [{ clientId: 'tab-a', client: 'web', clientLabel: 'Firefox', lastSeenAt: new Date().toISOString(), nowPlaying: null }],
    }]
    fetchMock.mockResolvedValueOnce(presence)
    const wrapper = await mountSuspended(UsersLive)

    expect(wrapper.text()).toContain('Idle')
  })

  it('polls every USERS_LIVE_REFRESH_MS while mounted', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue([])
    const wrapper = await mountSuspended(UsersLive)
    fetchMock.mockClear()

    await vi.advanceTimersByTimeAsync(USERS_LIVE_REFRESH_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(USERS_LIVE_REFRESH_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    wrapper.unmount()
  })

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue([])
    const wrapper = await mountSuspended(UsersLive)
    fetchMock.mockClear()

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(USERS_LIVE_REFRESH_MS * 3)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
