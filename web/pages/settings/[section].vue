<script setup lang="ts">
const SECTIONS: Record<string, { title: string; component: string }> = {
  library: { title: 'Library', component: 'SettingsLibraryForm' },
  downloads: { title: 'Downloads', component: 'SettingsDownloadsForm' },
  monitoring: { title: 'Monitoring', component: 'SettingsMonitoringForm' },
  storage: { title: 'Storage', component: 'SettingsStorageForm' },
  'api-keys': { title: 'API Keys', component: 'SettingsApiKeysForm' },
  scrobble: { title: 'Scrobble', component: 'SettingsScrobbleForm' },
  users: { title: 'Users', component: 'SettingsUsersForm' },
  permissions: { title: 'Permissions', component: 'SettingsPermissionsForm' },
}

definePageMeta({
  layout: 'admin',
  middleware: 'admin',
  validate: route => (route.params.section as string) in SECTIONS,
})

const route = useRoute()
const section = SECTIONS[route.params.section as string]!
useHead({ title: buildPageTitle('Settings', section.title) })
</script>

<template>
  <SettingsShell>
    <component :is="section.component" />
  </SettingsShell>
</template>
