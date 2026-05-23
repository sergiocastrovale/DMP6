<script setup lang="ts">
import {
  Home,
  Library,
  Compass,
  ListMusic,
  Heart,
  EllipsisVertical,
  Settings,
  LogOut,
  Clock,
  FlaskConical,
  BarChart3,
  AlertTriangle,
} from 'lucide-vue-next'

const route = useRoute()
const { logout, hasPerm, isAdmin } = useAuth()

const canViewPlaylists = hasPerm('playlists.view')
const canViewFavorites = hasPerm('favorites.view')
const canViewIssues = hasPerm('issues.view')

const showMore = ref(false)

const items = computed(() => {
  const all = [
    { to: '/', label: 'Home', icon: Home, show: true },
    { to: '/browse', label: 'Browse', icon: Library, show: true },
    { to: '/explore', label: 'Explore', icon: Compass, show: true },
    { to: '/playlists', label: 'Playlists', icon: ListMusic, show: canViewPlaylists.value },
    { to: '/favorites', label: 'Favorites', icon: Heart, show: canViewFavorites.value },
  ]
  return all.filter((i) => i.show)
})

const moreGroups = computed(() => [
  [
    { to: '/timeline', label: 'Timeline', icon: Clock, show: true },
    { to: '/labs', label: 'Labs', icon: FlaskConical, show: true },
  ].filter((i) => i.show),
  [
    { to: '/statistics', label: 'Statistics', icon: BarChart3, show: true },
    { to: '/issues', label: 'Issues', icon: AlertTriangle, show: canViewIssues.value },
  ].filter((i) => i.show),
  [
    { to: '/settings/library', label: 'Settings', icon: Settings, show: isAdmin.value },
    { label: 'Sign out', icon: LogOut, show: true, action: () => { showMore.value = false; logout() } },
  ].filter((i) => i.show),
])

const isActive = (path: string) => {
  if (path === '/') { return route.path === '/' }
  return route.path.startsWith(path)
}

const moreActive = computed(() =>
  moreGroups.value.some((g) => g.some((i) => 'to' in i && i.to && isActive(i.to))),
)

const closeMore = () => { showMore.value = false }

watch(route, closeMore)
</script>

<template>
  <nav class="fixed bottom-0 left-0 z-40 flex w-full border-t border-rule bg-bg lg:hidden">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors"
      :class="isActive(item.to) ? 'text-accent' : 'text-ink-3'"
    >
      <component :is="item.icon" :size="20" />
      <span>{{ item.label }}</span>
    </NuxtLink>

    <button
      class="flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors"
      :class="showMore || moreActive ? 'text-accent' : 'text-ink-3'"
      @click="showMore = !showMore"
    >
      <EllipsisVertical :size="20" />
      <span>More</span>
    </button>
  </nav>

  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="showMore"
        class="fixed inset-0 z-50 bg-black/50 lg:hidden"
        @click="closeMore"
      />
    </Transition>
    <Transition name="slide-up">
      <div
        v-if="showMore"
        class="fixed bottom-[57px] left-0 right-0 z-50 rounded-t-2xl border-t border-rule bg-bg px-4 pb-4 pt-3 lg:hidden"
      >
        <template v-for="(group, gi) in moreGroups" :key="gi">
          <div v-if="gi > 0" class="my-2 border-t border-rule" />
          <template v-for="item in group" :key="item.label">
            <NuxtLink
              v-if="'to' in item && item.to"
              :to="item.to"
              class="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors"
              :class="isActive(item.to) ? 'text-accent bg-accent-soft' : 'text-ink-2 hover:bg-bg-2'"
            >
              <component :is="item.icon" :size="20" />
              <span>{{ item.label }}</span>
            </NuxtLink>
            <button
              v-else-if="'action' in item"
              class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium text-ink-2 transition-colors hover:bg-bg-2"
              @click="item.action"
            >
              <component :is="item.icon" :size="20" />
              <span>{{ item.label }}</span>
            </button>
          </template>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s ease;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
