import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { isForeignKeyError } from '~/server/utils/prismaErrors'

const VALID_SOURCES = new Set(['QUEUE', 'PLAYLIST', 'CATALOGUE', 'EXPLORER', 'RANDOM'])

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)

  const body = (await readBody(event)) ?? {}
  const { trackId, source, duration } = body as { trackId?: string, source?: string, duration?: number }

  if (!trackId || !source || !VALID_SOURCES.has(source)) {
    throw createError({ statusCode: 400, statusMessage: 'Missing or invalid trackId/source' })
  }

  try {
    return await prisma.playEvent.create({
      data: {
        userId,
        trackId,
        source: source as 'QUEUE' | 'PLAYLIST' | 'CATALOGUE' | 'EXPLORER' | 'RANDOM',
        trackDuration: typeof duration === 'number' && Number.isFinite(duration) ? Math.round(duration) : null,
      },
      select: { id: true },
    })
  }
  catch (e) {
    if (isForeignKeyError(e)) {
      throw createError({ statusCode: 404, statusMessage: 'Track not found' })
    }
    throw e
  }
})
