<script setup lang="ts">
import SettingsSubsonicKeys from '~/components/settings/SubsonicKeys.vue'

// Same reasoning as pages/settings/themes.vue: a concrete route outranks [section], and this page
// deliberately has no `middleware: 'admin'` - API keys are a per-user credential, every role that
// can play music (play.view) can generate one.
definePageMeta({
  layout: 'admin',
})

useTitle('Settings', 'Subsonic')
</script>

<template>
  <SettingsShell>
    <SettingsSubsonicKeys />
  </SettingsShell>
</template>
