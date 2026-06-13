<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Settings · Monitoring' })
</script>

<template>
  <SettingsShell>
    <SettingsMonitoringForm />
  </SettingsShell>
</template>
