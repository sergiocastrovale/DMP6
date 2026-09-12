import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'

// Escapes LIKE/ILIKE metacharacters so a query containing %, _ or \ is matched literally instead
// of being treated as a wildcard. Prisma's own `contains` does this internally for its generated
// queries, but these raw queries build their own ILIKE patterns and need the same treatment.
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, char => `\\${char}`)

// Rank tiers, cheapest/most-specific first: exact match beats prefix beats word-boundary-contains
// beats plain substring. Keeps "HIM" from being buried under every artist whose name merely
// contains "him".
interface RankedIds {
  ids: string[]
  total: number
}

export const rankedArtistIds = async (q: string, skip: number, take: number): Promise<RankedIds> => {
  const like = `%${escapeLike(q)}%`
  const prefix = `${escapeLike(q)}%`

  const rows = await prisma.$queryRaw<{ id: string, total: bigint }[]>`
    SELECT id, count(*) OVER() AS total
    FROM "Artist"
    WHERE "primaryArtistId" IS NULL
      AND name ILIKE ${like}
    ORDER BY
      CASE
        WHEN lower(name) = lower(${q}) THEN 0
        WHEN name ILIKE ${prefix} THEN 1
        WHEN name ILIKE ${`% ${escapeLike(q)}%`} THEN 2
        ELSE 3
      END,
      "averageMatchScore" DESC NULLS LAST,
      name ASC,
      id ASC
    OFFSET ${skip} LIMIT ${take}
  `
  return { ids: rows.map(r => r.id), total: rows.length ? Number(rows[0]!.total) : await countArtists(like) }
}

export const rankedReleaseIds = async (q: string, skip: number, take: number): Promise<RankedIds> => {
  const like = `%${escapeLike(q)}%`
  const prefix = `${escapeLike(q)}%`
  const wordLike = `% ${escapeLike(q)}%`

  const rows = await prisma.$queryRaw<{ id: string, total: bigint }[]>`
    SELECT lr.id, count(*) OVER() AS total
    FROM "LocalRelease" lr
    LEFT JOIN "MusicBrainzRelease" mbr ON mbr.id = lr."releaseId"
    WHERE lr.title ILIKE ${like} OR mbr.title ILIKE ${like}
    ORDER BY
      CASE
        WHEN lower(COALESCE(lr.title, mbr.title)) = lower(${q}) THEN 0
        WHEN COALESCE(lr.title, mbr.title) ILIKE ${prefix} THEN 1
        WHEN COALESCE(lr.title, mbr.title) ILIKE ${wordLike} THEN 2
        ELSE 3
      END,
      lr."createdAt" DESC,
      lr.id ASC
    OFFSET ${skip} LIMIT ${take}
  `
  return { ids: rows.map(r => r.id), total: rows.length ? Number(rows[0]!.total) : await countReleases(like) }
}

export const rankedTrackIds = async (q: string, skip: number, take: number): Promise<RankedIds> => {
  const like = `%${escapeLike(q)}%`
  const prefix = `${escapeLike(q)}%`
  const wordLike = `% ${escapeLike(q)}%`

  const rows = await prisma.$queryRaw<{ id: string, total: bigint }[]>`
    SELECT id, count(*) OVER() AS total
    FROM "LocalReleaseTrack"
    WHERE title ILIKE ${like}
    ORDER BY
      CASE
        WHEN lower(title) = lower(${q}) THEN 0
        WHEN title ILIKE ${prefix} THEN 1
        WHEN title ILIKE ${wordLike} THEN 2
        ELSE 3
      END,
      title ASC,
      id ASC
    OFFSET ${skip} LIMIT ${take}
  `
  return { ids: rows.map(r => r.id), total: rows.length ? Number(rows[0]!.total) : await countTracks(like) }
}

// count(*) OVER() rides along with the page for free when a page has rows, but an empty page
// (skip past the end, or a 0-result query) needs its own count to report a correct `total`/0.
const countArtists = (like: string): Promise<number> =>
  prisma.artist.count({ where: { primaryArtistId: null, name: { contains: like.slice(1, -1), mode: 'insensitive' } } })

const countReleases = (like: string): Promise<number> => {
  const term = like.slice(1, -1)
  return prisma.localRelease.count({ where: { OR: [{ title: { contains: term, mode: 'insensitive' } }, { release: { title: { contains: term, mode: 'insensitive' } } }] } })
}

const countTracks = (like: string): Promise<number> =>
  prisma.localReleaseTrack.count({ where: { title: { contains: like.slice(1, -1), mode: 'insensitive' } } })

// Row shaping shared by the dropdown endpoint and the paged per-type endpoint, so the two can
// never drift on fields/image handling.
export const hydrateArtists = async (ids: string[]) => {
  if (!ids.length) {return []}
  const rows = await prisma.artist.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      slug: true,
      image: true,
      imageUrl: true,
      // Capped at the source: only ever need the first 3 for the "max 3, ellipsis" display, so
      // there's no reason to pull an artist's full genre list over the wire.
      genres: { select: { name: true }, take: 3 },
    },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map(artist => ({
    id: artist.id,
    name: artist.name,
    slug: artist.slug,
    genres: artist.genres.map(g => g.name),
    ...verifyImage(artist.image, artist.imageUrl, 'artists'),
  }))
}

export const hydrateReleases = async (ids: string[]) => {
  if (!ids.length) {return []}
  const rows = await prisma.localRelease.findMany({
    where: { id: { in: ids } },
    include: {
      artists: { select: { artist: { select: { id: true, name: true, slug: true } } } },
      release: { select: { title: true, type: { select: { name: true } } } },
    },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map(release => ({
    id: release.id,
    title: release.title || release.release?.title || 'Unknown Release',
    releaseType: release.release?.type?.name || null,
    year: release.year,
    ...verifyImage(release.image, release.imageUrl, 'releases'),
    artist: release.artists[0]?.artist ?? null,
  }))
}

export const hydrateTracks = async (ids: string[]) => {
  if (!ids.length) {return []}
  // Explicit `select` down every level - a plain `include` defaults to every scalar column
  // (timestamps, tag metadata, file paths...) on both LocalReleaseTrack and the nested
  // LocalRelease, none of which the dropdown/results row needs.
  const rows = await prisma.localReleaseTrack.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      trackNumber: true,
      duration: true,
      localRelease: {
        select: {
          id: true,
          title: true,
          year: true,
          image: true,
          imageUrl: true,
          artists: { select: { artist: { select: { id: true, name: true, slug: true } } } },
        },
      },
    },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map(track => ({
    id: track.id,
    title: track.title ?? '',
    trackNumber: track.trackNumber,
    duration: track.duration,
    release: track.localRelease
      ? {
          id: track.localRelease.id,
          title: track.localRelease.title,
          year: track.localRelease.year,
          ...verifyImage(track.localRelease.image, track.localRelease.imageUrl, 'releases'),
          artist: track.localRelease.artists[0]?.artist ?? null,
        }
      : null,
  }))
}
