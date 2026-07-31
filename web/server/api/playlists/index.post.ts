import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { generateSlug } from '~/server/utils/slug'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.crud')

  const body = await readBody(event)

  if (!body.name || typeof body.name !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid playlist name',
    })
  }

  const slug = generateSlug(body.name)

  // A name with no letters/digits (e.g. "!!!") strips to an empty slug - unroutable at /playlists/[slug].
  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Playlist name must contain at least one letter or number',
    })
  }

  // Check for duplicate slug
  const existing = await prisma.playlist.findUnique({
    where: { slug },
  })

  if (existing) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Playlist with this name already exists',
    })
  }

  const playlist = await prisma.playlist.create({
    data: {
      name: body.name,
      slug,
      description: body.description || null,
    },
  })

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
