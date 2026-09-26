import { describe, it, expect } from 'vitest'
import { createPlaylistBodySchema, addPlaylistTrackBodySchema } from '../../../server/schemas/playlists'

describe('createPlaylistBodySchema', () => {
  it('accepts a name and normalises a blank description to null', () => {
    expect(createPlaylistBodySchema.parse({ name: 'Mix', description: '' })).toEqual({ name: 'Mix', description: null })
    expect(createPlaylistBodySchema.parse({ name: 'Mix' }).description).toBeNull()
    expect(createPlaylistBodySchema.parse({ name: 'Mix', description: 'x' }).description).toBe('x')
  })

  it('rejects an empty body, empty name and non-string name', () => {
    expect(createPlaylistBodySchema.safeParse({}).success).toBe(false)
    expect(createPlaylistBodySchema.safeParse({ name: '' }).success).toBe(false)
    expect(createPlaylistBodySchema.safeParse({ name: 5 }).success).toBe(false)
  })
})

describe('addPlaylistTrackBodySchema', () => {
  it('requires a non-empty trackId', () => {
    expect(addPlaylistTrackBodySchema.parse({ trackId: 't1' })).toEqual({ trackId: 't1' })
    expect(addPlaylistTrackBodySchema.safeParse({}).success).toBe(false)
    expect(addPlaylistTrackBodySchema.safeParse({ trackId: '' }).success).toBe(false)
  })
})
