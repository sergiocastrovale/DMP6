<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · API Keys' })
</script>

<template>
  <SettingsShell>
    <SettingsApiKeysForm />
  </SettingsShell>
</template>
