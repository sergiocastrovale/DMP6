import { Prisma } from '@prisma/client'
import type { NetworkGraph, NetworkNode, NetworkLink } from '~/types/labs'

interface FullPairRow {
  main_artist_id: string
  related_artist_id: string
  shared_tracks: bigint
}

interface FocusPairRow {
  other_artist_id: string
  shared_tracks: bigint
}

interface TrackRow {
  artist_id: string
  track_id: string
  track_title: string
}

export default defineEventHandler(async (event): Promise<NetworkGraph> => {
  const query = getQuery(event)
  const artistId = query.artistId as string | undefined
  const minShared = Math.max(1, Number(query.minShared) || 2)

  if (artistId) {
    return getFocusedGraph(artistId)
  }
  return getFullGraph(minShared)
})

const getFullGraph = async (minShared: number): Promise<NetworkGraph> => {
  const pairs = await prisma.$queryRaw<FullPairRow[]>`
    SELECT
      lra."artistId" AS main_artist_id,
      tra."artistId" AS related_artist_id,
      COUNT(DISTINCT tra."trackId") AS shared_tracks
    FROM "TrackRelatedArtist" tra
    JOIN "LocalReleaseTrack" lrt ON lrt.id = tra."trackId"
    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
    WHERE lra."artistId" != tra."artistId"
      AND lrt."localReleaseId" IS NOT NULL
    GROUP BY lra."artistId", tra."artistId"
    HAVING COUNT(DISTINCT tra."trackId") >= ${minShared}
    ORDER BY shared_tracks DESC
    LIMIT 300
  `

  const nodeIds = new Set<string>()
  const links: NetworkLink[] = []
  const seen = new Set<string>()

  for (const row of pairs) {
    const [a, b] = [row.main_artist_id, row.related_artist_id].sort()
    const key = `${a}|${b}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    links.push({ source: a!, target: b!, sharedTracks: Number(row.shared_tracks), tracks: [] })
    nodeIds.add(a!)
    nodeIds.add(b!)
  }

  if (nodeIds.size === 0) {
    return { nodes: [], links: [] }
  }

  const artists = await prisma.artist.findMany({
    where: { id: { in: [...nodeIds] } },
    select: {
      id: true,
      name: true,
      slug: true,
      totalTracks: true,
      _count: { select: { trackRelatedArtists: true } },
    },
  })

  const nodes: NetworkNode[] = artists.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    trackCount: a.totalTracks + a._count.trackRelatedArtists,
    isFocus: false,
  }))

  return { nodes, links }
}

const getFocusedGraph = async (artistId: string): Promise<NetworkGraph> => {
  const pairs = await prisma.$queryRaw<FocusPairRow[]>`
    SELECT
      tra."artistId" AS other_artist_id,
      COUNT(DISTINCT tra."trackId") AS shared_tracks
    FROM "TrackRelatedArtist" tra
    JOIN "LocalReleaseTrack" lrt ON lrt.id = tra."trackId"
    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
    WHERE lra."artistId" = ${artistId}
      AND tra."artistId" != ${artistId}
      AND lrt."localReleaseId" IS NOT NULL
    GROUP BY tra."artistId"
    ORDER BY shared_tracks DESC
    LIMIT 50
  `

  if (pairs.length === 0) {
    const focusArtist = await prisma.artist.findUnique({
      where: { id: artistId },
      select: { id: true, name: true, slug: true, totalTracks: true },
    })
    if (!focusArtist) {
      return { nodes: [], links: [] }
    }
    return {
      nodes: [{
        id: focusArtist.id,
        name: focusArtist.name,
        slug: focusArtist.slug,
        trackCount: focusArtist.totalTracks,
        isFocus: true,
      }],
      links: [],
    }
  }

  const otherIds = pairs.map((p) => p.other_artist_id)

  const trackRows = await prisma.$queryRaw<TrackRow[]>`
    SELECT
      tra."artistId" AS artist_id,
      tra."trackId" AS track_id,
      lrt.title AS track_title
    FROM "TrackRelatedArtist" tra
    JOIN "LocalReleaseTrack" lrt ON lrt.id = tra."trackId"
    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
    WHERE lra."artistId" = ${artistId}
      AND tra."artistId" IN (${Prisma.join(otherIds)})
      AND lrt."localReleaseId" IS NOT NULL
  `

  const tracksByArtist = new Map<string, { id: string; title: string }[]>()
  for (const row of trackRows) {
    if (!tracksByArtist.has(row.artist_id)) {
      tracksByArtist.set(row.artist_id, [])
    }
    tracksByArtist.get(row.artist_id)!.push({ id: row.track_id, title: row.track_title || 'Untitled' })
  }

  const allIds = [artistId, ...otherIds]
  const artists = await prisma.artist.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true,
      name: true,
      slug: true,
      totalTracks: true,
      _count: { select: { trackRelatedArtists: true } },
    },
  })

  const nodes: NetworkNode[] = artists.map((a) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
    trackCount: a.totalTracks + a._count.trackRelatedArtists,
    isFocus: a.id === artistId,
  }))

  const links: NetworkLink[] = pairs.map((p) => ({
    source: artistId,
    target: p.other_artist_id,
    sharedTracks: Number(p.shared_tracks),
    tracks: (tracksByArtist.get(p.other_artist_id) || []).slice(0, 10),
  }))

  return { nodes, links }
}
