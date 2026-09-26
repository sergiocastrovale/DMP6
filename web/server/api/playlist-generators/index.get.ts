import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import type { PlaylistGeneratorRow } from '~/types/playlistGenerator'

export default defineEventHandler(async (event): Promise<PlaylistGeneratorRow[]> => {
  await requirePermission(event, 'playlists.generate')

  const generators = await prisma.playlistGenerator.findMany({
    orderBy: [{ type: 'asc' }, { name: 'asc' }],
    include: {
      playlist: {
        select: {
          updatedAt: true,
          _count: { select: { tracks: true } },
        },
      },
    },
  })

  return generators.map((g): PlaylistGeneratorRow => ({
    id: g.id,
    type: g.type as 'GENRE' | 'REGION',
    name: g.name,
    slug: g.slug,
    description: g.description,
    terms: g.terms,
    trackCount: g.playlist?._count.tracks ?? null,
    generatedAt: g.playlist?.updatedAt.toISOString() ?? null,
  }))
})
