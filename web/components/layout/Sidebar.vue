<script setup lang="ts">
import {
  Home,
  Library,
  Clock,
  ListMusic,
  Heart,
  BarChart3,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-vue-next'

const collapsed = ref(false)

const navItems = [
  { to: '/', label: 'Home', icon: Home },
  { to: '/browse', label: 'Browse', icon: Library },
  { to: '/timeline', label: 'Timeline', icon: Clock },
  { to: '/playlists', label: 'Playlists', icon: ListMusic },
  { to: '/favorites', label: 'Favorites', icon: Heart },
]

const route = useRoute()

function isActive(path: string) {
  if (path === '/') return route.path === '/'
  return route.path.startsWith(path)
}
</script>

<template>
  <aside
    :data-collapsed="collapsed || undefined"
    class="group/sidebar fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-zinc-800 bg-zinc-950 transition-all duration-200"
    :class="collapsed ? 'w-16' : 'w-56'"
  >
    <!-- Logo -->
    <div class="flex h-14 items-center justify-between px-3">
      <LayoutLogo />
      <button
        class="rounded-md p-1 text-zinc-400 hover:text-zinc-50 transition-opacity duration-200 group-data-[collapsed]/sidebar:hidden"
        @click="collapsed = !collapsed"
      >
        <PanelLeftClose :size="18" />
      </button>
      <button
        v-if="collapsed"
        class="rounded-md p-1 text-zinc-400 hover:text-zinc-50"
        @click="collapsed = !collapsed"
      >
        <PanelLeft :size="18" />
      </button>
    </div>

    <!-- Navigation -->
    <nav class="mt-2 flex flex-1 flex-col gap-1 px-2">
      <NuxtLink
        v-for="item in navItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        :class="
          isActive(item.to)
            ? 'bg-zinc-800 text-amber-500'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-50'
        "
      >
        <component :is="item.icon" :size="20" class="shrink-0" />
        <span class="transition-opacity duration-200 group-data-[collapsed]/sidebar:hidden">
          {{ item.label }}
        </span>
      </NuxtLink>
    </nav>

    <!-- Bottom: Statistics -->
    <div class="mb-4 px-2">
      <NuxtLink
        to="/statistics"
        class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        :class="
          isActive('/statistics')
            ? 'bg-zinc-800 text-amber-500'
            : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-50'
        "
      >
        <BarChart3 :size="20" class="shrink-0" />
        <span class="transition-opacity duration-200 group-data-[collapsed]/sidebar:hidden">
          Statistics
        </span>
      </NuxtLink>
    </div>
  </aside>
</template>
