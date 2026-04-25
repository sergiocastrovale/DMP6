import { getCachedSettings } from '~/server/utils/settingsCache'

export default defineEventHandler(() => {
  const s = getCachedSettings()
  return {
    imageStorage: s.imageStorage,
    s3PublicUrl: s.s3PublicUrl,
  }
})
