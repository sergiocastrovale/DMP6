<script setup lang="ts">
import {
  AlertTriangle,
  BarChart3,
  Clock,
  Compass,
  EllipsisVertical,
  FlaskConical,
  Heart,
  Home,
  Library,
  ListMusic,
  LogOut,
  Settings,
} from 'lucide-vue-next'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

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
  return all.filter(i => i.show)
})

const moreGroups = computed(() => [
  [
    { to: '/timeline', label: 'Timeline', icon: Clock, show: true },
    { to: '/labs', label: 'Labs', icon: FlaskConical, show: true },
  ].filter(i => i.show),
  [
    { to: '/statistics', label: 'Statistics', icon: BarChart3, show: true },
    { to: '/issues', label: 'Issues', icon: AlertTriangle, show: canViewIssues.value },
  ].filter(i => i.show),
  [
    { to: '/settings/library', label: 'Settings', icon: Settings, show: isAdmin.value },
    { label: 'Sign out', icon: LogOut, show: true, action: () => { showMore.value = false; logout() } },
  ].filter(i => i.show),
])

const isActive = (path: string) => {
  if (path === '/') {
    return route.path === '/'
  }
  return route.path.startsWith(path)
}

const moreActive = computed(() =>
  moreGroups.value.some(g => g.some(i => 'to' in i && i.to && isActive(i.to))),
)

const closeMore = () => { showMore.value = false }

watch(route, closeMore)
</script>

<template>
  <nav class="fixed bottom-0 left-0 z-40 flex w-full border-t border-stone-100/6 bg-stone-950 lg:hidden">
    <NuxtLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      :class="cx('flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors duration-150', isActive(item.to) ? 'text-amber-400' : 'text-stone-100/40')"
    >
      <component :is="item.icon" :size="20" :stroke-width="ICON_STROKE_WIDTH" />
      <span>{{ item.label }}</span>
    </NuxtLink>

    <button
      type="button"
      :aria-expanded="showMore"
      :class="cx('flex flex-1 flex-col items-center gap-1 py-2 text-xs transition-colors duration-150', (showMore || moreActive) ? 'text-amber-400' : 'text-stone-100/40')"
      @click="showMore = !showMore"
    >
      <EllipsisVertical :size="20" :stroke-width="ICON_STROKE_WIDTH" />
      <span>More</span>
    </button>
  </nav>

  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease"
      leave-to-class="opacity-0"
    >
      <div
        v-if="showMore"
        class="fixed inset-0 z-50 bg-black/50 lg:hidden"
        @click="closeMore"
      />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-[250ms] ease"
      enter-from-class="translate-y-full"
      leave-active-class="transition-transform duration-[250ms] ease"
      leave-to-class="translate-y-full"
    >
      <div
        v-if="showMore"
        class="fixed bottom-[57px] left-0 right-0 z-50 rounded-t-2xl border-t border-stone-100/6 bg-stone-950 px-4 pb-4 pt-3 lg:hidden"
      >
        <template v-for="(group, gi) in moreGroups" :key="gi">
          <div v-if="gi > 0" class="my-2 border-t border-stone-100/6" />
          <template v-for="item in group" :key="item.label">
            <NuxtLink
              v-if="'to' in item && item.to"
              :to="item.to"
              :class="cx('flex items-center gap-3 rounded-lg px-3 py-3 text-base font-medium transition-colors duration-150', isActive(item.to) ? 'bg-amber-400/20 text-amber-400' : 'text-stone-100/60 hover:bg-stone-800')"
            >
              <component :is="item.icon" :size="20" :stroke-width="ICON_STROKE_WIDTH" />
              <span>{{ item.label }}</span>
            </NuxtLink>
            <button
              v-else-if="'action' in item"
              type="button"
              class="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-base font-medium text-stone-100/60 transition-colors duration-150 hover:bg-stone-800"
              @click="item.action"
            >
              <component :is="item.icon" :size="20" :stroke-width="ICON_STROKE_WIDTH" />
              <span>{{ item.label }}</span>
            </button>
          </template>
        </template>
      </div>
    </Transition>
  </Teleport>
</template>
