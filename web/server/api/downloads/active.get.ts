import { getAllActiveDownloads } from '~/server/utils/downloads'

export default defineEventHandler(async () => {
  const downloads = await getAllActiveDownloads()
  return { downloads }
})
