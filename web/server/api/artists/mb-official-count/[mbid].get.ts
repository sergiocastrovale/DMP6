import { requirePermission } from '~/server/utils/permissions'
import { countOfficialReleaseGroups } from '~/server/utils/musicbrainz'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.run')

  const mbid = getRouterParam(event, 'mbid')
  if (!mbid) {throw createError({ statusCode: 400, statusMessage: 'Missing mbid' })}

  const count = await countOfficialReleaseGroups(mbid)
  return { count }
})
