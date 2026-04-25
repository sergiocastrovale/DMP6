<script setup lang="ts">
import { Settings } from 'lucide-vue-next'

const route = useRoute()
const tab = computed(() => route.params.tab as string)

const validTabs = ['library', 'downloads', 'storage', 'api-keys']
if (!validTabs.includes(tab.value)) {
  navigateTo('/settings/library')
}

useHead({ title: 'Settings' })
</script>

<template>
  <div class="flex flex-col">
    <SettingsTabs :current="tab" />

    <div class="p-6">
      <div class="mb-6 flex items-center gap-3">
        <Settings :size="24" class="text-amber-500" />
        <div>
          <h1 class="text-xl font-semibold text-white">Settings</h1>
          <p class="text-sm text-zinc-400">DB values override env vars</p>
        </div>
      </div>

      <SettingsLibraryForm v-if="tab === 'library'" />
      <SettingsDownloadsForm v-else-if="tab === 'downloads'" />
      <SettingsStorageForm v-else-if="tab === 'storage'" />
      <SettingsApiKeysForm v-else-if="tab === 'api-keys'" />
    </div>
  </div>
</template>
