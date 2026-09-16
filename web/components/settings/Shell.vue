<script setup lang="ts">
import { cx, layout } from '~/helpers/ui'
const { isAdmin } = useAuth()

// Themes and Subsonic are the settings pages that aren't admin-gated (per-browser preference /
// per-user credential, see pages/settings/themes.vue and pages/settings/subsonic.vue), so they're
// the only tabs a non-admin gets - every other route here bounces them home via middleware/admin.ts,
// and offering tabs that do that is worse than not offering them.
const themesTab = { key: 'themes', label: 'Themes', href: '/settings/themes' }
const subsonicTab = { key: 'subsonic', label: 'Subsonic', href: '/settings/subsonic' }

const adminTabs = [
  { key: 'library', label: 'Library', href: '/settings/library' },
  { key: 'downloads', label: 'Downloads', href: '/settings/downloads' },
  { key: 'storage', label: 'Storage', href: '/settings/storage' },
  { key: 'api-keys', label: 'API Keys', href: '/settings/api-keys' },
  { key: 'users', label: 'Users', href: '/settings/users' },
  { key: 'permissions', label: 'Permissions', href: '/settings/permissions' },
]

const tabs = computed(() => isAdmin.value ? [...adminTabs, subsonicTab, themesTab] : [subsonicTab, themesTab])
</script>

<template>
  <div :class="cx(layout.page)">
    <PageTitle text="Settings" subtext="DB values override env vars" />
    <Tabs :tabs="tabs" />
    <slot />
  </div>
</template>
