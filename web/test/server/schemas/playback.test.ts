import { describe, it, expect } from 'vitest'
import { exploreBodySchema, playEventBodySchema } from '../../../server/schemas/playback'
import { MAX_EXCLUDE_IDS } from '../../../helpers/constants'

describe('exploreBodySchema', () => {
  it('defaults every slider on an empty body', () => {
    expect(exploreBodySchema.parse({})).toEqual({ energy: 5, era: 5, familiarity: 4, sound: 4, excludeIds: [] })
  })

  it('rounds and clamps sliders to 0..9', () => {
    const r = exploreBodySchema.parse({ energy: 42, era: -3, familiarity: 2.6, sound: 0 })
    expect([r.energy, r.era, r.familiarity, r.sound]).toEqual([9, 0, 3, 0])
  })

  it('keeps only the newest excludeIds', () => {
    const ids = Array.from({ length: MAX_EXCLUDE_IDS + 5 }, (_, i) => `t${i}`)
    const r = exploreBodySchema.parse({ excludeIds: ids })
    expect(r.excludeIds).toHaveLength(MAX_EXCLUDE_IDS)
    expect(r.excludeIds.at(-1)).toBe(ids.at(-1))
  })

  it('rejects non-numeric sliders and non-string ids', () => {
    expect(exploreBodySchema.safeParse({ energy: 'high' }).success).toBe(false)
    expect(exploreBodySchema.safeParse({ excludeIds: [1] }).success).toBe(false)
  })
})

describe('playEventBodySchema', () => {
  it('accepts a valid body and rounds the duration', () => {
    expect(playEventBodySchema.parse({ trackId: 'x', source: 'QUEUE', duration: 200.6 }))
      .toEqual({ trackId: 'x', source: 'QUEUE', duration: 201 })
  })

  it('nulls a missing or non-finite duration', () => {
    expect(playEventBodySchema.parse({ trackId: 'x', source: 'RANDOM' }).duration).toBeNull()
    expect(playEventBodySchema.parse({ trackId: 'x', source: 'RANDOM', duration: 'a' }).duration).toBeNull()
  })

  it('rejects empty body, unknown source, empty trackId', () => {
    expect(playEventBodySchema.safeParse({}).success).toBe(false)
    expect(playEventBodySchema.safeParse({ trackId: 'x', source: 'SUBSONIC' }).success).toBe(false)
    expect(playEventBodySchema.safeParse({ trackId: '', source: 'QUEUE' }).success).toBe(false)
  })
})
