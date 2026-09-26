import { describe, it, expect } from 'vitest'
import { terminalRunBodySchema, terminalSessionBodySchema } from '../../../server/schemas/terminal'
import { mosaicBodySchema } from '../../../server/schemas/labs'
import { nowPlayingBodySchema, scrobbleBodySchema } from '../../../server/schemas/scrobble'

describe('terminalSessionBodySchema', () => {
  it('rejects an empty body and a shell-hostile session name', () => {
    expect(terminalSessionBodySchema.safeParse({}).success).toBe(false)
    expect(terminalSessionBodySchema.safeParse({ session: '"; rm -rf /' }).success).toBe(false)
  })
})

describe('terminalRunBodySchema', () => {
  it('needs command and session; args must be strings', () => {
    expect(terminalRunBodySchema.safeParse({}).success).toBe(false)
    expect(terminalRunBodySchema.safeParse({ command: './sync', session: '$(x)' }).success).toBe(false)
    expect(terminalRunBodySchema.safeParse({ command: './sync', args: [1], session: 'dmp-abc' }).success).toBe(false)
  })
})

describe('mosaicBodySchema', () => {
  it('falls back to chronological', () => {
    expect(mosaicBodySchema.parse({}).mode).toBe('chronological')
    expect(mosaicBodySchema.parse({ mode: 'nope' }).mode).toBe('chronological')
    expect(mosaicBodySchema.parse({ mode: 'random' }).mode).toBe('random')
  })
})

describe('scrobble schemas', () => {
  it('now-playing needs a trackId', () => {
    expect(nowPlayingBodySchema.safeParse({}).success).toBe(false)
    expect(nowPlayingBodySchema.parse({ trackId: 't' })).toEqual({ trackId: 't' })
  })

  it('scrobble needs a positive numeric timestamp (number or numeric string)', () => {
    expect(scrobbleBodySchema.parse({ trackId: 't', timestamp: 1700000000000 }).timestamp).toBe(1700000000000)
    expect(scrobbleBodySchema.parse({ trackId: 't', timestamp: '1700000000000' }).timestamp).toBe(1700000000000)
    expect(scrobbleBodySchema.safeParse({ trackId: 't', timestamp: 'x' }).success).toBe(false)
    expect(scrobbleBodySchema.safeParse({ trackId: 't', timestamp: 0 }).success).toBe(false)
    expect(scrobbleBodySchema.safeParse({ trackId: 't' }).success).toBe(false)
  })
})
