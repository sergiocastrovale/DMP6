export const useSettingsStore = defineStore('settings', () => {
  const imageStorage = ref('local')
  const storagePublicUrl = ref('')
  const showTerminal = ref(false)

  async function load() {
    const data = await $fetch<{ imageStorage: string; storagePublicUrl: string; showTerminal: boolean }>('/api/settings/public')
    imageStorage.value = data.imageStorage
    storagePublicUrl.value = data.storagePublicUrl
    showTerminal.value = data.showTerminal
  }

  return { imageStorage, storagePublicUrl, showTerminal, load }
})
