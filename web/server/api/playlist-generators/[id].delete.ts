import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.generate')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing generator id' })
  }

  const existing = await prisma.playlistGenerator.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Playlist generator not found' })
  }

  // Cascades to the generated Playlist (Playlist.generatorId onDelete: Cascade) - see
  // docs/feature_generated_playlists.md.
  await prisma.playlistGenerator.delete({ where: { id } })

  return { success: true }
})
