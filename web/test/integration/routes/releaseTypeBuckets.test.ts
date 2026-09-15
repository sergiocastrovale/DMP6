import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { releaseTypeBucketSql } from '../../../server/utils/releaseTypeBuckets'

// releaseTypeBucketSql (Statistics -> Release Types) uses ANY(text[]) array containment and an
// OFFSET/LIMIT string-built raw query, both Postgres-specific - exercised against real Postgres
// rather than faked in a JS unit test (classifyReleaseType's plain-TS twin is covered there instead).
const prisma = getTestPrisma()

const ensureType = async (name: string) =>
  prisma.releaseType.upsert({ where: { name }, create: { name, slug: name.toLowerCase() }, update: {} })

describe('releaseTypeBucketSql (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('buckets a mix of releases and rolls a linked duplicate onto its primary artist', async () => {
    const album = await ensureType('Album')
    const ep = await ensureType('EP')

    const artist = await prisma.artist.create({ data: { name: 'Radiohead', slug: 'radiohead' } })
    const dup = await prisma.artist.create({ data: { name: 'Radiohead (dup)', slug: 'radiohead-dup', primaryArtistId: artist.id } })

    const plainAlbum = await prisma.musicBrainzRelease.create({
      data: { title: 'OK Computer', typeId: album.id, musicbrainzId: 'mb-1', mediumCount: 1 },
    })
    const liveAlbum = await prisma.musicBrainzRelease.create({
      data: { title: 'I Might Be Wrong', typeId: album.id, musicbrainzId: 'mb-2', mediumCount: 1, releaseGroupSecondaryTypes: ['Live'] },
    })
    const boxByMediumCount = await prisma.musicBrainzRelease.create({
      data: { title: 'Anthology', typeId: album.id, musicbrainzId: 'mb-3', mediumCount: 3 },
    })
    const boxByPackaging = await prisma.musicBrainzRelease.create({
      data: { title: 'The Box', typeId: album.id, musicbrainzId: 'mb-4', mediumCount: 1, packaging: 'Box' },
    })
    const epRelease = await prisma.musicBrainzRelease.create({
      data: { title: 'Drill', typeId: ep.id, musicbrainzId: 'mb-5', mediumCount: 1 },
    })

    await prisma.localRelease.create({ data: { title: plainAlbum.title, releaseId: plainAlbum.id, groupKey: 'g1' } })
      .then(lr => prisma.localReleaseArtist.create({ data: { localReleaseId: lr.id, artistId: artist.id } }))
    await prisma.localRelease.create({ data: { title: liveAlbum.title, releaseId: liveAlbum.id, groupKey: 'g2' } })
      .then(lr => prisma.localReleaseArtist.create({ data: { localReleaseId: lr.id, artistId: dup.id } }))
    await prisma.localRelease.create({ data: { title: boxByMediumCount.title, releaseId: boxByMediumCount.id, groupKey: 'g3' } })
      .then(lr => prisma.localReleaseArtist.create({ data: { localReleaseId: lr.id, artistId: artist.id } }))
    await prisma.localRelease.create({ data: { title: boxByPackaging.title, releaseId: boxByPackaging.id, groupKey: 'g4' } })
      .then(lr => prisma.localReleaseArtist.create({ data: { localReleaseId: lr.id, artistId: artist.id } }))
    await prisma.localRelease.create({ data: { title: epRelease.title, releaseId: epRelease.id, groupKey: 'g5' } })
      .then(lr => prisma.localReleaseArtist.create({ data: { localReleaseId: lr.id, artistId: artist.id } }))
    await prisma.localRelease.create({ data: { title: 'Unmatched Bootleg', groupKey: 'g6' } })
      .then(lr => prisma.localReleaseArtist.create({ data: { localReleaseId: lr.id, artistId: artist.id } }))

    const rows = await prisma.$queryRawUnsafe<{ title: string, bucket: string }[]>(`
      SELECT lr."title", ${releaseTypeBucketSql} AS bucket
      FROM "LocalRelease" lr
      LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
      LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
      ORDER BY lr."title"
    `)
    expect(Object.fromEntries(rows.map(r => [r.title, r.bucket]))).toEqual({
      'Anthology': 'box-set',
      'Drill': 'ep',
      'I Might Be Wrong': 'live',
      'OK Computer': 'album',
      'The Box': 'box-set',
      'Unmatched Bootleg': 'unknown',
    })

    const artistCounts = await prisma.$queryRawUnsafe<{ name: string, count: bigint }[]>(`
      SELECT a2."name", COUNT(DISTINCT lr.id)::bigint AS count
      FROM "LocalRelease" lr
      JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
      JOIN "Artist" a ON a.id = lra."artistId"
      JOIN "Artist" a2 ON a2.id = COALESCE(a."primaryArtistId", a.id)
      LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
      LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
      WHERE (${releaseTypeBucketSql}) = 'box-set'
      GROUP BY a2.id, a2."name"
    `)
    // Both box-set releases are owned by "artist"; the live album (owned by the "dup" alias) is a
    // different bucket, so it must not appear here - and the dup must not show up as its own row.
    expect(artistCounts.map(r => ({ name: r.name, count: Number(r.count) }))).toEqual([
      { name: 'Radiohead', count: 2 },
    ])
  })

  // The pivoted table itself (server/api/stats/[type].get.ts's queryReleaseTypesPivot) - one row per
  // artist, one COUNT(*) FILTER column per bucket via a shared CTE. Reproduced here rather than
  // importing the (unexported) query function, same convention as artistsCompletenessSort.test.ts.
  it('pivots one row per artist with a FILTER column per bucket', async () => {
    const album = await ensureType('Album')
    const ep = await ensureType('EP')
    const artist = await prisma.artist.create({ data: { name: 'Radiohead', slug: 'radiohead' } })

    const albumRelease = await prisma.musicBrainzRelease.create({ data: { title: 'OK Computer', typeId: album.id, musicbrainzId: 'mb-p1', mediumCount: 1 } })
    const epRelease = await prisma.musicBrainzRelease.create({ data: { title: 'Drill', typeId: ep.id, musicbrainzId: 'mb-p2', mediumCount: 1 } })
    const boxRelease = await prisma.musicBrainzRelease.create({ data: { title: 'Anthology', typeId: album.id, musicbrainzId: 'mb-p3', mediumCount: 3 } })

    for (const [release, key] of [[albumRelease, 'g1'], [epRelease, 'g2'], [boxRelease, 'g3']] as const) {
      const lr = await prisma.localRelease.create({ data: { title: release.title, releaseId: release.id, groupKey: key } })
      await prisma.localReleaseArtist.create({ data: { localReleaseId: lr.id, artistId: artist.id } })
    }

    const rows = await prisma.$queryRawUnsafe<{ name: string, album: number, ep: number, 'box-set': number, live: number }[]>(`
      WITH release_buckets AS (
        SELECT lra."artistId", ${releaseTypeBucketSql} AS bucket
        FROM "LocalRelease" lr
        JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
        LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
        LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
      )
      SELECT a2."name",
        COUNT(*) FILTER (WHERE rb.bucket = 'album')::int AS album,
        COUNT(*) FILTER (WHERE rb.bucket = 'ep')::int AS ep,
        COUNT(*) FILTER (WHERE rb.bucket = 'box-set')::int AS "box-set",
        COUNT(*) FILTER (WHERE rb.bucket = 'live')::int AS live
      FROM release_buckets rb
      JOIN "Artist" a ON a.id = rb."artistId"
      JOIN "Artist" a2 ON a2.id = COALESCE(a."primaryArtistId", a.id)
      GROUP BY a2.id, a2."name"
    `)

    expect(rows).toEqual([{ name: 'Radiohead', album: 1, ep: 1, 'box-set': 1, live: 0 }])
  })

  // The drill-down (server/api/stats/[type].get.ts's queryReleaseTypeDetail) - one artist's releases
  // within one bucket, including a linked duplicate's own releases rolled onto the primary artist.
  it('detail: lists one artist\'s releases in one bucket, including a rolled-up duplicate\'s', async () => {
    const single = await ensureType('Single')
    const artist = await prisma.artist.create({ data: { name: 'Britney Spears', slug: 'britney-spears' } })
    const dup = await prisma.artist.create({ data: { name: 'Britney Spears (dup)', slug: 'britney-dup', primaryArtistId: artist.id } })

    const ownSingle = await prisma.musicBrainzRelease.create({ data: { title: 'Toxic', typeId: single.id, musicbrainzId: 'mb-d1', mediumCount: 1 } })
    const dupSingle = await prisma.musicBrainzRelease.create({ data: { title: 'Oops!... I Did It Again', typeId: single.id, musicbrainzId: 'mb-d2', mediumCount: 1 } })
    const album = await ensureType('Album')
    const otherAlbum = await prisma.musicBrainzRelease.create({ data: { title: 'In the Zone', typeId: album.id, musicbrainzId: 'mb-d3', mediumCount: 1 } })

    const lr1 = await prisma.localRelease.create({ data: { title: ownSingle.title, releaseId: ownSingle.id, groupKey: 'd1' } })
    await prisma.localReleaseArtist.create({ data: { localReleaseId: lr1.id, artistId: artist.id } })
    const lr2 = await prisma.localRelease.create({ data: { title: dupSingle.title, releaseId: dupSingle.id, groupKey: 'd2' } })
    await prisma.localReleaseArtist.create({ data: { localReleaseId: lr2.id, artistId: dup.id } })
    const lr3 = await prisma.localRelease.create({ data: { title: otherAlbum.title, releaseId: otherAlbum.id, groupKey: 'd3' } })
    await prisma.localReleaseArtist.create({ data: { localReleaseId: lr3.id, artistId: artist.id } })

    const rows = await prisma.$queryRawUnsafe<{ title: string, year: number | null }[]>(`
      SELECT DISTINCT lr.id, lr."title", lr."year"
      FROM "LocalRelease" lr
      JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
      JOIN "Artist" a ON a.id = lra."artistId"
      LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
      LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
      WHERE (${releaseTypeBucketSql}) = 'single' AND (a.id = $1 OR a."primaryArtistId" = $1)
      ORDER BY lr."title"
    `, artist.id)

    // Both singles show up (the dup's own, rolled onto the primary artist) - the album does not.
    expect(rows.map(r => r.title)).toEqual(['Oops!... I Did It Again', 'Toxic'])
  })
})
