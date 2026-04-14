import { getSlskdResults } from '~/server/utils/downloads'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'

export default defineEventHandler(async (event) => {
  const searchId = getRouterParam(event, 'id')
  if (!searchId) throw createError({ statusCode: 400, message: 'search id required' })

  const settings = await resolveDownloadSettings()
  const allowedFormats = settings.downloadFormats || undefined
  const minBitrate = settings.downloadMinBitrate ?? undefined

  const results = await getSlskdResults(searchId, allowedFormats, minBitrate)
  return { results }
})
