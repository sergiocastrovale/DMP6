// Small shared favourite reads/writes - used by both the web /api/favorites/* routes' upsert
// bodies and the Subsonic star/unstar endpoints (server/utils/subsonic/endpoints/annotation.ts).
// Error shaping (P2003 -> 404) stays at the call site, same as the existing favorites routes.
import { prisma } from '~/server/utils/prisma'

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
  return new Map(rows.map(r => [r.releaseId, r.createdAt]))
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
