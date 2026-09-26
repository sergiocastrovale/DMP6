import { Prisma } from '@prisma/client'
import { db, withStatementTimeout } from '~/server/utils/statementTimeout'
import { LABS_STATEMENT_TIMEOUT_MS } from '~/helpers/constants'
import { cachedResponse } from '~/server/utils/cache'
import type { NetworkGraph, NetworkNode, NetworkLink, FullPairRow, FocusPairRow, NetworkTrackRow } from '~/types/labs'

export default defineEventHandler(async (event): Promise<NetworkGraph> => {
  const query = getQuery(event)
  const artistId = query.artistId as string | undefined
  const minShared = Math.max(1, Number(query.minShared) || 2)

  // Both graphs aggregate TrackRelatedArtist x LocalReleaseTrack x LocalReleaseArtist with COUNT(DISTINCT) - fine
  // once, wasteful on every visit. Library-versioned, so a scan refreshes them; the focused one is per artist.
  if (artistId) {
    // artistId is caller-supplied text that would become part of a Redis key: only well-formed ids are cached.
    if (!/^[a-z0-9]{8,40}$/.test(artistId)) {
      return withStatementTimeout(LABS_STATEMENT_TIMEOUT_MS, () => getFocusedGraph(artistId))
    }
    return cachedResponse(`labs:network:focus:${artistId}`, 600, () => withStatementTimeout(LABS_STATEMENT_TIMEOUT_MS, () => getFocusedGraph(artistId)), { shared: true })
  }
  return cachedResponse(`labs:network:full:${minShared}`, 86400, () => withStatementTimeout(LABS_STATEMENT_TIMEOUT_MS, () => getFullGraph(minShared)), { shared: true })
})

const getFullGraph = async (minShared: number): Promise<NetworkGraph> => {
  const pairs = await db().$queryRaw<FullPairRow[]>`
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

  const artists = await db().artist.findMany({
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
  const pairs = await db().$queryRaw<FocusPairRow[]>`
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
    const focusArtist = await db().artist.findUnique({
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

  const trackRows = await db().$queryRaw<NetworkTrackRow[]>`
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
  const artists = await db().artist.findMany({
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
