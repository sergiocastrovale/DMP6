import type { DownloadSource } from '~/types/download'
import { cancelDownloadBySource } from '~/server/utils/downloads'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { source, username, id } = body as {
    source: DownloadSource
    username: string
    id: string
  }

  if (!source || !id) throw createError({ statusCode: 400, message: 'source and id are required' })

  await cancelDownloadBySource(source, username || '', id)
  return { success: true }
})
