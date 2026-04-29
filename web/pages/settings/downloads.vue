<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · Downloads' })
</script>

<template>
  <SettingsShell>
    <SettingsDownloadsForm />
  </SettingsShell>
</template>
