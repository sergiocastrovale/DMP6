export const useSettingsStore = defineStore('settings', () => {
  const imageStorage = ref('local')
  const storagePublicUrl = ref('')

  async function load() {
    const data = await $fetch<{ imageStorage: string; storagePublicUrl: string }>('/api/settings/public')
    imageStorage.value = data.imageStorage
    storagePublicUrl.value = data.storagePublicUrl
  }

  return { imageStorage, storagePublicUrl, load }
})
