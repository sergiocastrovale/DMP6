import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')

  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing playlist slug',
    })
  }

  const playlist = await prisma.playlist.findUnique({
    where: { slug },
  })

  if (!playlist) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Playlist not found',
    })
  }

  // Delete playlist and all its tracks
  await prisma.playlist.delete({
    where: { slug },
  })

  return { success: true, message: 'Playlist deleted' }
})
