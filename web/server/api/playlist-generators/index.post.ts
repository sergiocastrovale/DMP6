import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { generateSlug } from '~/server/utils/slug'
import { validateGenerator } from '~/helpers/playlistGenerators'
import { readBodyOf } from '~/server/utils/requestValidation'
import { createGeneratorBodySchema } from '~/server/schemas/playlistGenerators'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.generate')

  const { type, name, description, terms } = await readBodyOf(event, createGeneratorBodySchema)

  const error = validateGenerator({ type, name, terms })
  if (error) {
    throw createError({ statusCode: 400, statusMessage: error })
  }

  const slug = generateSlug(name)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Name must contain at least one letter or number' })
  }

  const existing = await prisma.playlistGenerator.findUnique({ where: { slug } })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'A playlist generator with this name already exists' })
  }

  const generator = await prisma.playlistGenerator.create({
    data: { type, name, slug, description, terms },
  })

  return { success: true, generator }
})
