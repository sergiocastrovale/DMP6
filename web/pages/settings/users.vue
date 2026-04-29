<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · Users' })
</script>

<template>
  <SettingsShell>
    <SettingsUsersForm />
  </SettingsShell>
</template>
