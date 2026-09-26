<script setup lang="ts">
import SettingsLastfmConnect from '~/components/settings/LastfmConnect.vue'

// Same reasoning as pages/settings/subsonic.vue: a concrete route outranks [section], and this page deliberately has no
// `middleware: 'admin'` - a Last.fm session is a per-user credential, every role that can play music (play.view)
// connects its own account.
definePageMeta({
  layout: 'admin',
})

useTitle('Settings', 'Last.fm')
</script>

<template>
  <SettingsShell>
    <SettingsLastfmConnect />
  </SettingsShell>
</template>
