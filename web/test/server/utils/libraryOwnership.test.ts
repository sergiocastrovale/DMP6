import { describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'

const findFirstMock = vi.fn()

vi.mock('~/server/utils/prisma', () => ({
  prisma: { playlist: { findFirst: (...args: unknown[]) => findFirstMock(...args) } },
}))

describe('libraryOwnership', () => {
  it('currentUserId reads event.context.user.id', async () => {
    const { currentUserId } = await import('../../../server/utils/libraryOwnership')
    const event = { context: { user: { id: 7 } } } as unknown as H3Event
    expect(currentUserId(event)).toBe(7)
  })

  it('visiblePlaylistsWhere matches own rows or generated (userId null) rows', async () => {
    const { visiblePlaylistsWhere } = await import('../../../server/utils/libraryOwnership')
    expect(visiblePlaylistsWhere(7)).toEqual({ OR: [{ userId: 7 }, { userId: null }] })
  })

  describe('findOwnManualPlaylist', () => {
    it('returns the playlist when it belongs to this user', async () => {
      findFirstMock.mockResolvedValue({ id: 'p1', slug: 'my-mix', userId: 7, type: 'MANUAL' })
      const { findOwnManualPlaylist } = await import('../../../server/utils/libraryOwnership')
      const result = await findOwnManualPlaylist('my-mix', 7)
      expect(result.id).toBe('p1')
      expect(findFirstMock).toHaveBeenCalledWith({ where: { slug: 'my-mix', userId: 7 } })
    })

    it('404s when no row matches this slug for this user (never owned, another user\'s, or generated)', async () => {
      findFirstMock.mockResolvedValue(null)
      const { findOwnManualPlaylist } = await import('../../../server/utils/libraryOwnership')
      await expect(findOwnManualPlaylist('someone-elses-mix', 7)).rejects.toMatchObject({ statusCode: 404 })
    })
  })
})
