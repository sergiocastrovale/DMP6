<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · Storage' })
</script>

<template>
  <SettingsShell>
    <SettingsStorageForm />
  </SettingsShell>
</template>
