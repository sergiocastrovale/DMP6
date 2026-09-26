// Small shared favourite reads/writes - used by both the web /api/favorites/* routes' upsert
// bodies and the Subsonic star/unstar endpoints (server/utils/subsonic/endpoints/annotation.ts).
// Error shaping (P2003 -> 404) stays at the call site, same as the existing favorites routes.
import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'

export const favoriteTrackDates = async (userId: number, trackIds: string[]): Promise<Map<string, Date>> => {
  if (!trackIds.length) {return new Map()}
  const rows = await prisma.favoriteTrack.findMany({
    where: { userId, trackId: { in: trackIds } },
    select: { trackId: true, createdAt: true },
  })
  return new Map(rows.map(r => [r.trackId, r.createdAt]))
}

export const favoriteReleaseDates = async (userId: number, releaseIds: string[]): Promise<Map<string, Date>> => {
  if (!releaseIds.length) {return new Map()}
  const rows = await prisma.favoriteRelease.findMany({
    where: { userId, releaseId: { in: releaseIds } },
    select: { releaseId: true, createdAt: true },
  })
  return new Map(rows.flatMap(r => r.releaseId ? [[r.releaseId, r.createdAt] as const] : []))
}

// Stamps `isFavorite` on each real (non-missing) track of a payload, using one query scoped to those ids.
// Lets a track list render its hearts from the same response instead of every list component fetching the
// user's first 50 favorites and hoping the track is among them.
export const attachTrackFavorites = async <T extends { id: string, missing?: boolean }>(
  userId: number,
  tracks: T[],
): Promise<(T & { isFavorite: boolean })[]> => {
  const dates = await favoriteTrackDates(userId, tracks.filter(t => !t.missing).map(t => t.id))
  return tracks.map(t => ({ ...t, isFavorite: dates.has(t.id) }))
}

// Ids of every release-shaped thing this user has favorited: a LocalRelease id, or a dissolved box's
// MusicBrainzRelease id (FavoriteRelease.boxReleaseId) - the same "target id" the artist page favorites by
// (helpers/artistPageLogic.ts favoriteTargetId). One row per favorite, so bounded by what the user has
// actually starred; the caller intersects it with the ids on screen.
export const favoriteReleaseTargetIds = async (userId: number): Promise<Set<string>> => {
  const rows = await prisma.favoriteRelease.findMany({
    where: { userId },
    select: { releaseId: true, boxReleaseId: true },
  })
  return new Set(rows.flatMap(r => r.releaseId ?? r.boxReleaseId ?? []))
}

export const starTrack = (userId: number, trackId: string) =>
  prisma.favoriteTrack.upsert({
    where: { userId_trackId: { userId, trackId } },
    create: { userId, trackId },
    update: {},
  })

export const unstarTrack = (userId: number, trackId: string) =>
  prisma.favoriteTrack.deleteMany({ where: { userId, trackId } })

export const starRelease = (userId: number, releaseId: string) =>
  prisma.favoriteRelease.upsert({
    where: { userId_releaseId: { userId, releaseId } },
    create: { userId, releaseId },
    update: {},
  })

export const unstarRelease = (userId: number, releaseId: string) =>
  prisma.favoriteRelease.deleteMany({ where: { userId, releaseId } })

const artistPick = { take: 1, select: { artist: { select: { id: true, name: true, slug: true } } } } as const

// `include` for FavoriteRelease list reads: the LocalRelease a plain favorite points at, or the box a
// box favorite points at (a dissolved box has no LocalRelease - its first disc supplies cover + artist).
export const favoriteReleaseInclude = {
  release: { include: { artists: artistPick } },
  box: {
    select: {
      id: true,
      title: true,
      year: true,
      boxDiscs: {
        orderBy: { boxMediumPosition: 'asc' },
        take: 1,
        select: { image: true, imageUrl: true, artists: artistPick },
      },
    },
  },
} as const

type FavoriteReleaseRow = Awaited<ReturnType<typeof prisma.favoriteRelease.findMany<{ include: typeof favoriteReleaseInclude }>>>[number]

// One release card for a favorite, whichever kind it is. `id` is the id the artist page and player
// address it by: the LocalRelease id, or the box's MusicBrainzRelease id (which /api/releases/[id]/tracks
// resolves to every disc's tracks). Null when the target vanished mid-request.
export const favoriteReleaseCard = (fav: FavoriteReleaseRow) => {
  const source = fav.release ?? fav.box?.boxDiscs[0]
  const target = fav.release ?? fav.box
  if (!source || !target) {return null}
  const img = verifyImage(source.image, source.imageUrl, 'releases')
  return {
    id: target.id,
    title: target.title,
    year: target.year,
    image: img.image,
    imageUrl: img.imageUrl,
    artist: source.artists[0]?.artist ?? null,
  }
}
