import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { findArtistByMbid } from '../../../server/utils/artistByMbid'

// `manuallyAdded` (./add, CLAUDE.md Data Model) lets an artist added before owning any files still
// show up in /browse. Exercised against real Postgres for the same reason as
// artistsCompletenessSort.test.ts - the `where` shape server/api/artists/index.get.ts builds is
// reproduced here directly rather than reimplemented as a unit-test fake.
const prisma = getTestPrisma()

const browseWhere = { primaryArtistId: null, OR: [{ localReleases: { some: {} } }, { manuallyAdded: true }] }

describe('manuallyAdded artists (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('browse shows a file-less manuallyAdded artist', async () => {
    await prisma.artist.create({ data: { name: 'New Band', slug: 'new-band', manuallyAdded: true } })

    const rows = await prisma.artist.findMany({ where: browseWhere, select: { slug: true } })
    expect(rows.map(a => a.slug)).toEqual(['new-band'])
  })

  it('still hides a file-less artist that is not manuallyAdded (credit-only)', async () => {
    await prisma.artist.create({ data: { name: 'Credit Only', slug: 'credit-only' } })

    const rows = await prisma.artist.findMany({ where: browseWhere, select: { slug: true } })
    expect(rows).toEqual([])
  })

  it('findArtistByMbid resolves a connected duplicate to its primary artist', async () => {
    const primary = await prisma.artist.create({ data: { name: 'Primary', slug: 'primary', musicbrainzId: 'mbid-1' } })
    await prisma.artist.create({ data: { name: 'Dup', slug: 'dup', musicbrainzId: 'mbid-1', primaryArtistId: primary.id } })

    const resolved = await findArtistByMbid('mbid-1')
    expect(resolved?.slug).toBe('primary')
  })

  it('findArtistByMbid returns null when nothing matches', async () => {
    expect(await findArtistByMbid('nope')).toBeNull()
  })
})
