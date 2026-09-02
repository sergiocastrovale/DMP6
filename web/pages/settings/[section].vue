<script setup lang="ts">
import type { Component } from 'vue'
import SettingsLibraryForm from '~/components/settings/LibraryForm.vue'
import SettingsDownloadsForm from '~/components/settings/DownloadsForm.vue'
import SettingsStorageForm from '~/components/settings/StorageForm.vue'
import SettingsApiKeysForm from '~/components/settings/ApiKeysForm.vue'
import SettingsUsersForm from '~/components/settings/UsersForm.vue'
import SettingsPermissionsForm from '~/components/settings/PermissionsForm.vue'

const SECTIONS: Record<string, { title: string; component: Component }> = {
  library: { title: 'Library', component: SettingsLibraryForm },
  downloads: { title: 'Downloads', component: SettingsDownloadsForm },
  storage: { title: 'Storage', component: SettingsStorageForm },
  'api-keys': { title: 'API Keys', component: SettingsApiKeysForm },
  users: { title: 'Users', component: SettingsUsersForm },
  permissions: { title: 'Permissions', component: SettingsPermissionsForm },
}

definePageMeta({
  layout: 'admin',
  middleware: 'admin',
  validate: route => (route.params.section as string) in SECTIONS,
})

const route = useRoute()
const section = SECTIONS[route.params.section as string]!
useTitle('Settings', section.title)
</script>

<template>
  <SettingsShell>
    <component :is="section.component" />
  </SettingsShell>
</template>
