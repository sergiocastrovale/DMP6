export const useSettingsStore = defineStore('settings', () => {
  const imageStorage = ref('local')
  const s3PublicUrl = ref('')

  async function load() {
    const data = await $fetch<{ imageStorage: string; s3PublicUrl: string }>('/api/settings/public')
    imageStorage.value = data.imageStorage
    s3PublicUrl.value = data.s3PublicUrl
  }

  return { imageStorage, s3PublicUrl, load }
})
