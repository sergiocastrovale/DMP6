import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeArtist, makeLocalRelease } from '../../factories'
import { fetchCountryRows } from '../../../server/utils/countryCovers'

const prisma = getTestPrisma()

const own = async (artistId: string, releaseId: string) =>
  prisma.localReleaseArtist.create({ data: { artistId, localReleaseId: releaseId } })

describe('fetchCountryRows (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('counts artists, not distinct covers', async () => {
    // One artist with three different covers - the old query would have reported 3.
    const solo = await makeArtist(prisma, { name: 'Solo', slug: 'solo', country: 'SE' })
    for (const image of ['a.jpg', 'b.jpg', 'c.jpg']) {
      await own(solo.id, (await makeLocalRelease(prisma, { image })).id)
    }
    // Two artists sharing one cover - the old query would have reported 1.
    const shared = await makeLocalRelease(prisma, { image: 'shared.jpg' })
    for (const slug of ['duo-a', 'duo-b']) {
      await own((await makeArtist(prisma, { name: slug, slug, country: 'NO' })).id, shared.id)
    }

    const rows = await fetchCountryRows(prisma)
    const byCountry = new Map(rows.map(r => [r.country, r]))

    expect(byCountry.get('SE')?.artist_count).toBe('1')
    expect(byCountry.get('SE')?.images).toHaveLength(3)
    expect(byCountry.get('NO')?.artist_count).toBe('2')
    expect(byCountry.get('NO')?.images).toHaveLength(1)
  })

  it('keeps each image paired with its own imageUrl', async () => {
    const artist = await makeArtist(prisma, { name: 'Pair', slug: 'pair', country: 'DE' })
    await own(artist.id, (await makeLocalRelease(prisma, { image: 'local-only.jpg', imageUrl: null, createdAt: new Date('2024-01-01') })).id)
    await own(artist.id, (await makeLocalRelease(prisma, { image: null, imageUrl: 'https://cdn/remote.jpg', createdAt: new Date('2023-01-01') })).id)
    await own(artist.id, (await makeLocalRelease(prisma, { image: 'both.jpg', imageUrl: 'https://cdn/both.jpg', createdAt: new Date('2022-01-01') })).id)

    const [row] = await fetchCountryRows(prisma)

    expect(row!.images).toEqual([
      { image: 'local-only.jpg', imageUrl: null },
      { image: null, imageUrl: 'https://cdn/remote.jpg' },
      { image: 'both.jpg', imageUrl: 'https://cdn/both.jpg' },
    ])
  })

  it('ignores connected duplicate artists, artists without releases and covers-less countries', async () => {
    const primary = await makeArtist(prisma, { name: 'Primary', slug: 'primary', country: 'FR' })
    await makeArtist(prisma, { name: 'Dup', slug: 'dup', country: 'FR', primaryArtistId: primary.id })
    await makeArtist(prisma, { name: 'No files', slug: 'no-files', country: 'FR' })
    await own(primary.id, (await makeLocalRelease(prisma, { image: 'fr.jpg' })).id)
    const coverless = await makeArtist(prisma, { name: 'Coverless', slug: 'coverless', country: 'IT' })
    await own(coverless.id, (await makeLocalRelease(prisma, { image: null, imageUrl: null })).id)

    const rows = await fetchCountryRows(prisma)

    expect(rows.map(r => [r.country, r.artist_count])).toEqual([['FR', '1']])
  })

  it('caps covers at 150 per country, newest first', async () => {
    const artist = await makeArtist(prisma, { name: 'Prolific', slug: 'prolific', country: 'US' })
    for (let i = 0; i < 155; i++) {
      await own(artist.id, (await makeLocalRelease(prisma, { image: `c${i}.jpg`, createdAt: new Date(2020, 0, 1, 0, 0, i) })).id)
    }

    const [row] = await fetchCountryRows(prisma)

    expect(row!.images).toHaveLength(150)
    expect(row!.images![0]!.image).toBe('c154.jpg')
  })
})
