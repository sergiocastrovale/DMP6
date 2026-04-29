<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · Permissions' })
</script>

<template>
  <SettingsShell>
    <SettingsPermissionsForm />
  </SettingsShell>
</template>
