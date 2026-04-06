import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const trackId = getRouterParam(event, 'id')

  if (!trackId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing track ID',
    })
  }

  const entries = await prisma.playlistTrack.findMany({
    where: { trackId },
    select: { playlist: { select: { slug: true } } },
  })

  return entries.map(e => e.playlist.slug)
})
