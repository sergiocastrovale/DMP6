import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { isForeignKeyError } from '~/server/utils/prismaErrors'
import { readBodyOf } from '~/server/utils/requestValidation'
import { playEventBodySchema } from '~/server/schemas/playback'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)

  const { trackId, source, duration } = await readBodyOf(event, playEventBodySchema)

  try {
    return await prisma.playEvent.create({
      data: {
        userId,
        trackId,
        source,
        trackDuration: duration,
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
