import { describe, expect, it } from 'vitest'
import { createSeeker } from '../../../../server/utils/subsonic/seek'

// A pretend table of ids '0000'...'9999' in id order, counting how many rows each fetch had to skip.
const table = Array.from({ length: 10_000 }, (_, i) => ({ id: String(i).padStart(5, '0') }))

const makeFetch = () => {
  const skips: number[] = []
  const fetch = async (afterId: string | null, skip: number, take: number) => {
    skips.push(skip)
    const start = afterId === null ? 0 : table.findIndex(r => r.id > afterId)
    return start === -1 ? [] : table.slice(start + skip, start + skip + take)
  }
  return { fetch, skips }
}

describe('createSeeker', () => {
  it('returns exactly the rows a plain OFFSET would, at every position', async () => {
    const seeker = createSeeker(1000, async () => 1)
    const { fetch } = makeFetch()

    // A sequential sync first (builds checkpoints), then arbitrary jumps.
    for (let offset = 0; offset < 10_000; offset += 500) {
      expect((await seeker.page('k', offset, 500, fetch)).map(r => r.id)).toEqual(table.slice(offset, offset + 500).map(r => r.id))
    }
    for (const offset of [0, 1, 999, 1000, 1001, 4321, 9500, 9999, 12_000]) {
      expect((await seeker.page('k', offset, 500, fetch)).map(r => r.id)).toEqual(table.slice(offset, offset + 500).map(r => r.id))
    }
  })

  it('bounds the rows skipped by the interval once a sequential pass has laid checkpoints', async () => {
    const seeker = createSeeker(1000, async () => 1)
    const { fetch, skips } = makeFetch()
    for (let offset = 0; offset < 10_000; offset += 500) {
      await seeker.page('k', offset, 500, fetch)
    }
    skips.length = 0

    await seeker.page('k', 9500, 500, fetch)
    await seeker.page('k', 7250, 100, fetch)

    expect(Math.max(...skips)).toBeLessThan(1000)
    // Without checkpoints the same requests would skip 9,500 and 7,250 rows.
  })

  it('cold jumps still work (no checkpoint yet) - they just skip the whole way', async () => {
    const seeker = createSeeker(1000, async () => 1)
    const { fetch, skips } = makeFetch()

    const rows = await seeker.page('k', 8000, 10, fetch)

    expect(rows.map(r => r.id)).toEqual(table.slice(8000, 8010).map(r => r.id))
    expect(skips).toEqual([8000])
  })

  it('drops every checkpoint when the library version changes', async () => {
    let version = 1
    const seeker = createSeeker(1000, async () => version)
    const { fetch, skips } = makeFetch()
    for (let offset = 0; offset < 3000; offset += 500) {await seeker.page('k', offset, 500, fetch)}
    skips.length = 0

    version = 2 // a scan re-ordered things
    await seeker.page('k', 2500, 500, fetch)

    expect(skips).toEqual([2500]) // back to a full skip
  })

  it('keeps separate checkpoint sets per key', async () => {
    const seeker = createSeeker(1000, async () => 1)
    const { fetch, skips } = makeFetch()
    for (let offset = 0; offset < 3000; offset += 500) {await seeker.page('artists', offset, 500, fetch)}
    skips.length = 0

    await seeker.page('songs', 2500, 500, fetch)

    expect(skips).toEqual([2500])
  })

  it('handles a short final page and an empty page past the end', async () => {
    const seeker = createSeeker(1000, async () => 1)
    const { fetch } = makeFetch()
    expect(await seeker.page('k', 9990, 500, fetch)).toHaveLength(10)
    expect(await seeker.page('k', 20_000, 500, fetch)).toEqual([])
  })
})
