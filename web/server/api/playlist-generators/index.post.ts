import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { generateSlug } from '~/server/utils/slug'
import { parseTerms, validateGenerator } from '~/helpers/playlistGenerators'
import type { PlaylistGeneratorType } from '~/types/playlistGenerator'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.generate')

  const body = await readBody(event)

  const type: PlaylistGeneratorType = body?.type
  const name: string = typeof body?.name === 'string' ? body.name.trim() : ''
  const description: string | null = typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : null
  const terms = parseTerms(Array.isArray(body?.terms) ? body.terms.join('\n') : String(body?.terms ?? ''))

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
