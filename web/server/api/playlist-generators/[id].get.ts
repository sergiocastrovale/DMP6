import { prisma } from '~/server/utils/prisma'
import { requireRole } from '~/server/utils/permissions'
import type { PlaylistGeneratorRow } from '~/types/playlistGenerator'

export default defineEventHandler(async (event): Promise<PlaylistGeneratorRow> => {
  requireRole(event, 'ADMIN')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing generator id' })
  }

  const generator = await prisma.playlistGenerator.findUnique({
    where: { id },
    include: {
      playlist: {
        select: {
          updatedAt: true,
          _count: { select: { tracks: true } },
        },
      },
    },
  })

  if (!generator) {
    throw createError({ statusCode: 404, statusMessage: 'Playlist generator not found' })
  }

  return {
    id: generator.id,
    type: generator.type as 'GENRE' | 'REGION',
    name: generator.name,
    slug: generator.slug,
    description: generator.description,
    terms: generator.terms,
    trackCount: generator.playlist?._count.tracks ?? null,
    generatedAt: generator.playlist?.updatedAt.toISOString() ?? null,
  }
})
