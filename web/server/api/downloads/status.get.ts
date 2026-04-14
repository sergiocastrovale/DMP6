import { getDownloadStatus } from '~/server/utils/downloads'

export default defineEventHandler(async () => {
  return getDownloadStatus()
})
