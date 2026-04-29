<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · Library' })
</script>

<template>
  <SettingsShell>
    <SettingsLibraryForm />
  </SettingsShell>
</template>
