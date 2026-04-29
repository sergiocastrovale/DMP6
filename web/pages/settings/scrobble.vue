<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · Scrobble' })
</script>

<template>
  <SettingsShell>
    <SettingsScrobbleForm />
  </SettingsShell>
</template>
