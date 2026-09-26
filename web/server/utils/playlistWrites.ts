import { prisma } from '~/server/utils/prisma'
import { isUniqueConstraintError } from '~/server/utils/prismaErrors'
import { visiblePlaylistsWhere } from '~/server/utils/libraryOwnership'

const nameTaken = () => createError({ statusCode: 409, statusMessage: 'Playlist with this name already exists' })

// Creates a MANUAL playlist for `userId`. The pre-check covers both unique constraints at once (the user's own slug
// and a shared generated one); the catch covers two concurrent creates that both passed it and lost on P2002.
export const createManualPlaylist = async (
  userId: number,
  data: { name: string, slug: string, description?: string | null },
) => {
  const existing = await prisma.playlist.findFirst({
    where: { slug: data.slug, ...visiblePlaylistsWhere(userId) },
    select: { id: true },
  })
  if (existing) {
    throw nameTaken()
  }
  try {
    return await prisma.playlist.create({
      data: { name: data.name, slug: data.slug, description: data.description ?? null, userId },
    })
  }
  catch (e) {
    throw isUniqueConstraintError(e) ? nameTaken() : e
  }
}

// Appends at MAX(position)+1. READ COMMITTED lets two concurrent adds both read the same maximum, so the
// transaction first takes a per-playlist advisory lock that is released at commit; appends to different
// playlists do not wait on each other.
export const appendPlaylistTrack = (playlistId: string, trackId: string) =>
  prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${playlistId}))`
    const top = await tx.playlistTrack.findFirst({
      where: { playlistId },
      orderBy: { position: 'desc' },
      select: { position: true },
    })
    return tx.playlistTrack.create({
      data: { playlistId, trackId, position: (top?.position ?? -1) + 1 },
    })
  })
