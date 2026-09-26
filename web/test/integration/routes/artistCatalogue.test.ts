import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeArtist, makeLocalRelease, makeLocalTrack, makeMbRelease, makeMbTrack, makeUser } from '../../factories'
import { applyPlays, buildArtistCatalogue, playReleaseIds } from '../../../server/utils/artistCatalogue'
import { releasePlayTotals } from '../../../server/utils/userPlays'

vi.mock('../../../server/utils/images', () => ({
  verifyImage: (image: string | null, imageUrl: string | null) => ({ image, imageUrl }),
  primeImageExistence: async () => {},
}))

const prisma = getTestPrisma()

const own = (artistId: string, localReleaseId: string) => prisma.localReleaseArtist.create({ data: { artistId, localReleaseId } })
const credit = (artistId: string, releaseId: string) => prisma.musicBrainzReleaseArtist.create({ data: { artistId, releaseId } })

describe('buildArtistCatalogue (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('404s for an unknown artist', async () => {
    await expect(buildArtistCatalogue('nobody')).rejects.toMatchObject({ statusCode: 404 })
  })

  it('builds owned, gap and appears-on cards with track counts read from the database', async () => {
    const artist = await makeArtist(prisma, { name: 'Band', slug: 'band' })
    const other = await makeArtist(prisma, { name: 'Other', slug: 'other' })

    // Owned album: 3 MB tracks, 2 local tracks.
    const owned = await makeMbRelease(prisma, { title: 'Owned Album', status: 'INCOMPLETE', year: 2001 })
    for (let i = 1; i <= 3; i++) {await makeMbTrack(prisma, owned.id, { position: i })}
    await credit(artist.id, owned.id)
    const local = await makeLocalRelease(prisma, { title: 'Owned Album', releaseId: owned.id, matchStatus: 'INCOMPLETE' })
    await own(artist.id, local.id)
    await makeLocalTrack(prisma, { localReleaseId: local.id })
    await makeLocalTrack(prisma, { localReleaseId: local.id })

    // Gap: in the catalogue, never owned.
    const gap = await makeMbRelease(prisma, { title: 'Missing Album', status: 'MISSING', year: 2003 })
    for (let i = 1; i <= 5; i++) {await makeMbTrack(prisma, gap.id, { position: i })}
    await credit(artist.id, gap.id)

    // Appears on: a local release of this artist bound to somebody else's MB release.
    const guestMb = await makeMbRelease(prisma, { title: 'Compilation', status: 'COMPLETE', year: 1999 })
    await makeMbTrack(prisma, guestMb.id, { position: 1 })
    await credit(other.id, guestMb.id)
    const guestLocal = await makeLocalRelease(prisma, { title: 'Compilation', releaseId: guestMb.id, matchStatus: 'COMPLETE' })
    await own(artist.id, guestLocal.id)
    await makeLocalTrack(prisma, { localReleaseId: guestLocal.id })

    const cards = await buildArtistCatalogue('band')
    const byTitle = new Map(cards.map(c => [c.title, c]))

    expect(cards.map(c => c.title)).toEqual(['Compilation', 'Owned Album', 'Missing Album']) // year ascending
    expect(byTitle.get('Owned Album')).toMatchObject({ hasLocal: true, trackCount: 3, localTrackCount: 2, status: 'INCOMPLETE' })
    expect(byTitle.get('Missing Album')).toMatchObject({ hasLocal: false, trackCount: 5, localTrackCount: 0, status: 'MISSING' })
    expect(byTitle.get('Compilation')).toMatchObject({ hasLocal: true, trackCount: 1, localTrackCount: 1 })
    // Nothing user-specific is baked in - it has to be safe to cache for everyone.
    expect(cards.every(c => c.totalPlayCount === 0)).toBe(true)
  })

  it('includes connected duplicate artists\' catalogue, labelled with who owns it', async () => {
    const main = await makeArtist(prisma, { name: 'Main', slug: 'main' })
    const dup = await makeArtist(prisma, { name: 'Main (dup)', slug: 'main-dup', primaryArtistId: main.id })
    const mb = await makeMbRelease(prisma, { title: 'Dup Album', status: 'COMPLETE' })
    await credit(dup.id, mb.id)
    const local = await makeLocalRelease(prisma, { title: 'Dup Album', releaseId: mb.id, matchStatus: 'COMPLETE' })
    await own(dup.id, local.id)

    const [card] = await buildArtistCatalogue('main')

    expect(card).toMatchObject({ title: 'Dup Album', connectedArtistName: 'Main (dup)' })
  })

  it('reports box-set membership (alsoPartOf) for a release group reprinted in a box', async () => {
    const artist = await makeArtist(prisma, { name: 'Boxed', slug: 'boxed' })
    const album = await makeMbRelease(prisma, { title: 'Studio Album', releaseGroupId: 'rg-1', status: 'COMPLETE' })
    await credit(artist.id, album.id)
    const box = await makeMbRelease(prisma, { title: 'The Big Box', mediumCount: 2, status: 'MISSING' })
    await prisma.musicBrainzReleaseMedium.create({ data: { releaseId: box.id, position: 1, equivalentReleaseGroupId: 'rg-1' } })

    const cards = await buildArtistCatalogue('boxed')

    expect(cards.find(c => c.title === 'Studio Album')?.alsoPartOf).toEqual([{ releaseId: box.id, title: 'The Big Box', year: 2020 }])
  })
})

describe('applyPlays', () => {
  it('sums plays over a card\'s own release, or over every disc of a dissolved box', () => {
    const cards = [
      { localReleaseId: 'a', boxDiscReleaseIds: undefined, totalPlayCount: 0 },
      { localReleaseId: null, boxDiscReleaseIds: ['d1', 'd2'], totalPlayCount: 0 },
      { localReleaseId: null, boxDiscReleaseIds: undefined, totalPlayCount: 0 },
    ] as never[]
    const plays = new Map([['a', { totalPlayCount: 4 }], ['d1', { totalPlayCount: 2 }], ['d2', { totalPlayCount: 3 }]])

    expect(applyPlays(cards, plays).map(c => c.totalPlayCount)).toEqual([4, 5, 0])
    expect(playReleaseIds({ localReleaseId: null, boxDiscReleaseIds: ['d1'] })).toEqual(['d1'])
  })

  it('takes the per-user totals straight from LocalReleaseTrackPlay', async () => {
    await resetDb()
    const user = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)
    const t1 = await makeLocalTrack(prisma, { localReleaseId: release.id })
    const t2 = await makeLocalTrack(prisma, { localReleaseId: release.id })
    await prisma.localReleaseTrackPlay.createMany({
      data: [
        { userId: user.id, trackId: t1.id, playCount: 2, lastPlayedAt: new Date() },
        { userId: user.id, trackId: t2.id, playCount: 5, lastPlayedAt: new Date() },
      ],
    })

    const plays = await releasePlayTotals(user.id, [release.id])
    const [card] = applyPlays([{ localReleaseId: release.id, totalPlayCount: 0 } as never], plays)

    expect(card!.totalPlayCount).toBe(7)
  })
})

describe('a Bach-sized catalogue', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('assembles ~6,000 MusicBrainz releases (90k tracks) well inside the response budget', async () => {
    const artist = await makeArtist(prisma, { name: 'Prolific', slug: 'prolific' })
    const type = await prisma.releaseType.upsert({ where: { name: 'Album' }, create: { name: 'Album', slug: 'album' }, update: {} })
    await prisma.$executeRawUnsafe(`
      INSERT INTO "MusicBrainzRelease" (id, title, "typeId", year, "musicbrainzId", "releaseGroupId", status, "updatedAt")
      SELECT 'perf-mb-' || g, 'Perf Album ' || g, '${type.id}', 1700 + g % 300, 'perf-mbid-' || g, 'perf-rg-' || (g / 2), 'MISSING', now()
      FROM generate_series(1, 6000) g`)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "MusicBrainzReleaseArtist" (id, "releaseId", "artistId")
      SELECT 'perf-mra-' || g, 'perf-mb-' || g, '${artist.id}' FROM generate_series(1, 6000) g`)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "MusicBrainzReleaseTrack" (id, title, position, "releaseId", "updatedAt")
      SELECT 'perf-t-' || g || '-' || t, 'Track ' || t, t, 'perf-mb-' || g, now()
      FROM generate_series(1, 6000) g, generate_series(1, 15) t`)
    await prisma.$executeRawUnsafe('ANALYZE')

    const started = performance.now()
    const cards = await buildArtistCatalogue('prolific')
    const elapsed = performance.now() - started

    expect(cards).toHaveLength(6000)
    expect(cards.every(c => c.trackCount === 15)).toBe(true)
    // The budget is generous for shared CI hardware; the point is that it's seconds, not the tens of seconds
    // (and megabytes of track ids) the per-track selects cost.
    expect(elapsed).toBeLessThan(4000)
  })
})
