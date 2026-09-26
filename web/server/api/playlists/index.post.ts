import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { generateSlug } from '~/server/utils/slug'
import { readBodyOf } from '~/server/utils/requestValidation'
import { createPlaylistBodySchema } from '~/server/schemas/playlists'
import { currentUserId, visiblePlaylistsWhere } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.crud')
  const userId = currentUserId(event)

  const body = await readBodyOf(event, createPlaylistBodySchema)

  const slug = generateSlug(body.name)

  // A name with no letters/digits (e.g. "!!!") strips to an empty slug - unroutable at /playlists/[slug].
  if (!slug) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Playlist name must contain at least one letter or number',
    })
  }

  // Check for a collision against anything this user would see under that slug - their own
  // playlist, or a shared generated one (own-slug uniqueness and generated-slug uniqueness are two
  // separate DB constraints; this covers both with one query).
  const existing = await prisma.playlist.findFirst({
    where: { slug, ...visiblePlaylistsWhere(userId) },
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
      description: body.description,
      userId,
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
