import { cancelDownloadBySource } from '~/server/utils/downloads'

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { username, id } = body as {
    username: string
    id: string
  }

  if (!id) { throw createError({ statusCode: 400, message: 'id is required' }) }

  await cancelDownloadBySource(username || '', id)
  return { success: true }
})
