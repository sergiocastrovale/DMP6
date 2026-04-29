<script setup lang="ts">
import { Settings } from 'lucide-vue-next'

const { isAdmin } = useAuth()

const baseTabs = [
  { key: 'library', label: 'Library', href: '/settings/library' },
  { key: 'downloads', label: 'Downloads', href: '/settings/downloads' },
  { key: 'storage', label: 'Storage', href: '/settings/storage' },
  { key: 'api-keys', label: 'API Keys', href: '/settings/api-keys' },
  { key: 'scrobble', label: 'Scrobble', href: '/settings/scrobble' },
]

const adminTabs = [
  { key: 'users', label: 'Users', href: '/settings/users' },
  { key: 'permissions', label: 'Permissions', href: '/settings/permissions' },
]

const tabs = computed(() => isAdmin.value ? [...baseTabs, ...adminTabs] : baseTabs)
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageTitle :icon="Settings" text="Settings" subtext="DB values override env vars" />
    <Tabs :tabs="tabs" />
    <slot />
  </div>
</template>
