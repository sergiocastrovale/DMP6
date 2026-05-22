<script setup lang="ts">
const settingsStore = useSettingsStore()
const globalStore = useGlobalStore()
await useAsyncData('app-settings', () => settingsStore.load())
onMounted(() => globalStore.fetch())
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
