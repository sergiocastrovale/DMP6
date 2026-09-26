import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeLocalRelease, makeLocalTrack } from '../../../test/factories'
import { fetchRelatedArtists } from '../../../server/utils/relatedArtists'

const prisma = getTestPrisma()

describe('related artists (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const credit = async (trackId: string, artistId: string) =>
    prisma.trackRelatedArtist.create({ data: { trackId, artistId } })

  it('lists collaborators on releases the artist owns, most frequent first, never the artist themself', async () => {
    const owner = await makeArtist(prisma, { name: 'Owner' })
    const often = await makeArtist(prisma, { name: 'Zed Often' })
    const once = await makeArtist(prisma, { name: 'Alpha Once' })
    const unrelated = await makeArtist(prisma, { name: 'Elsewhere' })
    const release = await makeLocalRelease(prisma)
    await prisma.localReleaseArtist.create({ data: { localReleaseId: release.id, artistId: owner.id } })
    const t1 = await makeLocalTrack(prisma, { localReleaseId: release.id })
    const t2 = await makeLocalTrack(prisma, { localReleaseId: release.id })
    await credit(t1.id, often.id)
    await credit(t2.id, often.id)
    await credit(t1.id, once.id)
    await credit(t1.id, owner.id)
    const other = await makeLocalRelease(prisma)
    const t3 = await makeLocalTrack(prisma, { localReleaseId: other.id })
    await credit(t3.id, unrelated.id)

    const related = await fetchRelatedArtists(owner.id)

    expect(related.map(a => a.name)).toEqual(['Zed Often', 'Alpha Once'])
  })

  it('breaks ties by name and caps the list at the limit', async () => {
    const owner = await makeArtist(prisma, { name: 'Owner' })
    const release = await makeLocalRelease(prisma)
    await prisma.localReleaseArtist.create({ data: { localReleaseId: release.id, artistId: owner.id } })
    const track = await makeLocalTrack(prisma, { localReleaseId: release.id })
    for (const name of ['Delta', 'Bravo', 'Charlie', 'Alpha']) {
      await credit(track.id, (await makeArtist(prisma, { name })).id)
    }

    expect((await fetchRelatedArtists(owner.id, 3)).map(a => a.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })
})
