import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { generateSlug } from '~/server/utils/slug'
import { parseTerms, validateGenerator } from '~/helpers/playlistGenerators'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'playlists.generate')

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing generator id' })
  }

  const existing = await prisma.playlistGenerator.findUnique({ where: { id } })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Playlist generator not found' })
  }

  const body = await readBody(event)

  const name: string = typeof body?.name === 'string' ? body.name.trim() : ''
  const description: string | null = typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : null
  const terms = parseTerms(Array.isArray(body?.terms) ? body.terms.join('\n') : String(body?.terms ?? ''))

  // Type is fixed at creation - genre/region matching logic is entirely different, so switching
  // it on an existing generator would silently repurpose whatever playlist it already produced.
  const error = validateGenerator({ type: existing.type as 'GENRE' | 'REGION', name, terms })
  if (error) {
    throw createError({ statusCode: 400, statusMessage: error })
  }

  const slug = generateSlug(name)
  if (!slug) {
    throw createError({ statusCode: 400, statusMessage: 'Name must contain at least one letter or number' })
  }

  if (slug !== existing.slug) {
    const clash = await prisma.playlistGenerator.findUnique({ where: { slug } })
    if (clash) {
      throw createError({ statusCode: 409, statusMessage: 'A playlist generator with this name already exists' })
    }
  }

  const generator = await prisma.playlistGenerator.update({
    where: { id },
    data: { name, slug, description, terms },
  })

  return { success: true, generator }
})
