import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

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
