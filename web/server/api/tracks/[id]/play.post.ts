import { prisma } from '~/server/utils/prisma'
import { invalidateCache } from '~/server/utils/cache'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { recordPlay } from '~/server/utils/userPlays'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')
  const userId = currentUserId(event)

  const id = getRouterParam(event, 'id')
  if (!id) {throw createError({ statusCode: 400, statusMessage: 'Missing id' })}

  const track = await prisma.localReleaseTrack.findUnique({
    where: { id },
    select: { id: true },
  })

  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found' })
  }

  await recordPlay(userId, id, new Date())

  // Play counts/lastPlayedAt are computed per-user at read time (server/utils/userPlays.ts), never
  // cached, so the only cached endpoint left that changes on a play is last-played itself.
  await invalidateCache(`releases:last-played:${userId}:*`)

  return { ok: true }
})
