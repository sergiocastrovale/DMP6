<script setup lang="ts">
defineProps<{ current: string }>()

const tabs = [
  { key: 'library', label: 'Library', href: '/settings/library' },
  { key: 'downloads', label: 'Downloads', href: '/settings/downloads' },
  { key: 'storage', label: 'Storage', href: '/settings/storage' },
  { key: 'api-keys', label: 'API Keys', href: '/settings/api-keys' },
]
</script>

<template>
  <div class="flex gap-1 border-b border-zinc-800 px-4 pt-2 overflow-x-auto">
    <NuxtLink
      v-for="tab in tabs"
      :key="tab.key"
      :to="tab.href"
      class="whitespace-nowrap rounded-t px-3 py-2 text-sm transition-colors"
      :class="current === tab.key
        ? 'border-b-2 border-blue-500 text-white'
        : 'text-zinc-400 hover:text-zinc-200'"
    >
      {{ tab.label }}
    </NuxtLink>
  </div>
</template>
