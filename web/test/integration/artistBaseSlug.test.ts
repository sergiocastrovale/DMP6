import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../setup/db'

// Artist.baseSlug groups homonyms (scripts/common/src/homonyms.rs). Every insert site - the Rust scripts, fixtures, the
// web app - leaves it out and relies on the BEFORE INSERT trigger from migration 20260927000000_artist_homonyms.
const prisma = getTestPrisma()

describe('Artist.baseSlug (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('defaults to the slug when an insert leaves it out', async () => {
    const artist = await prisma.artist.create({ data: { name: 'NAPA', slug: 'napa' } })
    expect(artist.baseSlug).toBe('napa')
  })

  it('keeps an explicit value, which is how a suffixed homonym is stored', async () => {
    const artist = await prisma.artist.create({ data: { name: 'Napa', slug: 'napa-9f3423ee', baseSlug: 'napa' } })
    expect(artist.baseSlug).toBe('napa')
  })

  it('is not touched by an update of the slug', async () => {
    const artist = await prisma.artist.create({ data: { name: 'NAPA', slug: 'napa' } })
    const renamed = await prisma.artist.update({ where: { id: artist.id }, data: { slug: 'napa-d76eeba7' } })
    expect(renamed.baseSlug).toBe('napa')
  })

  it('records an old slug, and the history goes with the artist', async () => {
    const artist = await prisma.artist.create({ data: { name: 'NAPA', slug: 'napa-d76eeba7', baseSlug: 'napa' } })
    await prisma.artistSlugHistory.create({ data: { oldSlug: 'napa', artistId: artist.id } })
    await prisma.artist.delete({ where: { id: artist.id } })
    expect(await prisma.artistSlugHistory.count()).toBe(0)
  })
})
