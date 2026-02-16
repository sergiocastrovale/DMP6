import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  // Try as MusicBrainzRelease first
  const mbRelease = await prisma.musicBrainzRelease.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      localReleases: {
        select: { id: true },
        take: 1,
      },
    },
  })

  const localReleaseId = mbRelease?.localReleases[0]?.id

  if (localReleaseId) {
    return getLocalReleaseTracks(localReleaseId)
  }

  // Try as LocalRelease
  return getLocalReleaseTracks(id)
})

async function getLocalReleaseTracks(localReleaseId: string) {
  const release = await prisma.localRelease.findUnique({
    where: { id: localReleaseId },
    select: {
      id: true,
      title: true,
      image: true,
      imageUrl: true,
      artist: { select: { name: true, slug: true } },
    },
  })

  const tracks = await prisma.localReleaseTrack.findMany({
    where: { localReleaseId },
    select: {
      id: true,
      title: true,
      artist: true,
      albumArtist: true,
      album: true,
      year: true,
      genre: true,
      duration: true,
      trackNumber: true,
      discNumber: true,
      playCount: true,
      filePath: true,
      localReleaseId: true,
    },
    orderBy: [{ discNumber: 'asc' }, { trackNumber: 'asc' }],
  })

  return {
    release: release
      ? {
          id: release.id,
          title: release.title,
          image: release.image,
          imageUrl: release.imageUrl,
          artistName: release.artist.name,
          artistSlug: release.artist.slug,
        }
      : null,
    tracks,
  }
}
