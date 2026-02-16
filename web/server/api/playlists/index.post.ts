import { prisma } from '~/server/utils/prisma'

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)

  if (!body.name || typeof body.name !== 'string') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid playlist name',
    })
  }

  const slug = generateSlug(body.name)

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
