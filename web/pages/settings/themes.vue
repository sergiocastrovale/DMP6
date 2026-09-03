<script setup lang="ts">
import SettingsThemesForm from '~/components/settings/ThemesForm.vue'

// A concrete route outranks the [section] catch-all, so this page's own meta applies - deliberately
// WITHOUT `middleware: 'admin'`. The accent theme is a per-browser preference, not a server
// setting, so every logged-in role can change it (auth.global.ts still requires a session).
definePageMeta({
  layout: 'admin',
})

useTitle('Settings', 'Themes')
</script>

<template>
  <SettingsShell>
    <SettingsThemesForm />
  </SettingsShell>
</template>
