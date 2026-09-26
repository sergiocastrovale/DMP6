import { createManualPlaylist } from '~/server/utils/playlistWrites'
import { requirePermission } from '~/server/utils/permissions'
import { playlistSlug } from '~/server/utils/slug'
import { readBodyOf } from '~/server/utils/requestValidation'
import { createPlaylistBodySchema } from '~/server/schemas/playlists'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.crud')
  const userId = currentUserId(event)

  const body = await readBodyOf(event, createPlaylistBodySchema)

  const slug = playlistSlug(body.name)

  const playlist = await createManualPlaylist(userId, { name: body.name, slug, description: body.description })

  return {
    success: true,
    playlist: {
      id: playlist.id,
      name: playlist.name,
      slug: playlist.slug,
      description: playlist.description,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
    },
  }
})
