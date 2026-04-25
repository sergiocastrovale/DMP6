<script setup lang="ts">
const settingsStore = useSettingsStore()
await useAsyncData('app-settings', () => settingsStore.load())
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
