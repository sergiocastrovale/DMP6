<script setup lang="ts">
import { Music, Pause, Play, Radio } from 'lucide-vue-next'
import type { UserPresence } from '~/types/auth'
import { timeAgo } from '~/helpers/functions'
import { USERS_LIVE_REFRESH_MS } from '~/helpers/constants'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const { data: presence, refresh } = await useAsyncData('settings-users-presence', () =>
  useCookieFetch<UserPresence[]>('/api/users/presence'),
)

let pollInterval: ReturnType<typeof setInterval> | null = null

const startPolling = () => {
  if (pollInterval) {return}
  pollInterval = setInterval(refresh, USERS_LIVE_REFRESH_MS)
}

const stopPolling = () => {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
}

// Same pattern as visualizer/Canvas.vue's visibilitychange handler - no point polling a hidden tab.
const onVisibilityChange = () => {
  if (document.hidden) {
    stopPolling()
  }
  else {
    refresh()
    startPolling()
  }
}

onMounted(() => {
  startPolling()
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  stopPolling()
  document.removeEventListener('visibilitychange', onVisibilityChange)
})

const { releaseImage } = useImageUrl()
</script>

<template>
  <UiCard title="Connected now" :icon="Radio">
    <p v-if="!presence?.length" class="text-sm text-stone-100/55">
      No one connected
    </p>
    <div v-else class="flex flex-col divide-y divide-stone-100/6">
      <div
        v-for="session in presence.flatMap(u => u.sessions.map(s => ({ user: u, session: s })))"
        :key="`${session.user.userId}:${session.session.clientId}`"
        class="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
      >
        <span class="mt-1.5 size-2 shrink-0 rounded-full bg-success" />
        <UiThumb v-if="session.session.nowPlaying" size="sm">
          <img
            v-if="releaseImage(session.session.nowPlaying)"
            :src="releaseImage(session.session.nowPlaying)!"
            :alt="session.session.nowPlaying.title"
            class="h-full w-full object-cover"
          >
          <div v-else class="flex h-full w-full items-center justify-center text-stone-100/20">
            <Music class="size-4" />
          </div>
        </UiThumb>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 text-sm">
            <span class="font-medium text-stone-100">{{ session.user.username }}</span>
            <Bullet />
            <span class="text-stone-100/55">{{ session.session.clientLabel }}</span>
            <Bullet />
            <span class="text-stone-100/40">{{ timeAgo(session.session.lastSeenAt) }}</span>
          </div>
          <div v-if="session.session.nowPlaying" class="mt-1 flex items-center gap-1.5 text-sm text-stone-100/60">
            <component
              :is="session.session.nowPlaying.playing ? Play : Pause"
              :size="13"
              :stroke-width="ICON_STROKE_WIDTH"
              class="shrink-0 text-amber-400"
            />
            <span class="truncate text-stone-100/80">{{ session.session.nowPlaying.title }}</span>
            <template v-if="session.session.nowPlaying.artist">
              <Bullet />
              <NuxtLink
                v-if="session.session.nowPlaying.artistSlug"
                :to="`/artist/${session.session.nowPlaying.artistSlug}`"
                class="truncate transition-colors duration-150 hover:text-stone-100"
              >
                {{ session.session.nowPlaying.artist }}
              </NuxtLink>
              <span v-else class="truncate">{{ session.session.nowPlaying.artist }}</span>
            </template>
            <template v-if="session.session.nowPlaying.album">
              <Bullet />
              <span class="truncate">{{ session.session.nowPlaying.album }}</span>
            </template>
          </div>
          <p v-else class="mt-1 text-sm text-stone-100/40">
            Idle
          </p>
        </div>
      </div>
    </div>
  </UiCard>
</template>
