<script setup lang="ts">
import { storeToRefs } from 'pinia'

const store = useDownloadsStore()
const { sources, slskd, prowlarr, qbittorrent } = storeToRefs(store)

const find = (name: 'RUTRACKER' | 'SLSKD') => sources.value.find(s => s.name === name)

// RuTracker needs both Prowlarr (search) and qBittorrent (download); Soulseek needs slskd.
const rtConnected = computed(() => prowlarr.value.connected && qbittorrent.value.connected)
const rtHint = computed(() => {
  if (rtConnected.value) {
    return 'Prowlarr + qBittorrent connected'
  }
  if (!prowlarr.value.configured && !qbittorrent.value.configured) {
    return 'not configured'
  }
  if (!prowlarr.value.connected) {
    return 'Prowlarr offline'
  }
  if (!qbittorrent.value.connected) {
    return 'qBittorrent offline'
  }
  return 'offline'
})
const slskHint = computed(() => slskd.value.connected ? 'connected' : slskd.value.configured ? 'offline' : 'not configured')

const rtEnabled = computed({
  get: () => find('RUTRACKER')?.enabled ?? false,
  set: v => store.toggleSource('RUTRACKER', v).catch(() => {}),
})
const slskEnabled = computed({
  get: () => find('SLSKD')?.enabled ?? false,
  set: v => store.toggleSource('SLSKD', v).catch(() => {}),
})

onMounted(() => {
  store.fetchSources()
  store.checkStatus()
  // One-shot queue read so the shared idle banner has acquisition data here; the live poll
  // self-starts/stops via the store as sources are toggled.
  store.fetchQueue()
})
onUnmounted(() => {
  store.stopQueuePolling()
})
</script>

<template>
  <UiCard title="Sources">
    <p class="text-sm text-stone-100/55">
      Where dmp searches for missing releases. RuTracker is tried first; Soulseek is the fallback.
    </p>

    <div class="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div class="flex items-center gap-2">
        <Switch v-model="rtEnabled">
          <span class="flex items-center gap-2">
            RuTracker
            <span class="inline-flex items-center gap-1 text-xs text-stone-100/55">
              <span class="size-1.5 rounded-full" :class="rtConnected ? 'bg-success' : 'bg-stone-100/20'" />
              {{ rtHint }}
            </span>
          </span>
        </Switch>
        <span class="rounded-md bg-stone-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-stone-100/55" title="Tried first when enabled">priority</span>
      </div>

      <div class="flex items-center gap-2">
        <Switch v-model="slskEnabled">
          <span class="flex items-center gap-2">
            Soulseek
            <span class="inline-flex items-center gap-1 text-xs text-stone-100/55">
              <span class="size-1.5 rounded-full" :class="slskd.connected ? 'bg-success' : 'bg-stone-100/20'" />
              {{ slskHint }}
            </span>
          </span>
        </Switch>
        <span class="rounded-md bg-stone-800 px-1.5 py-0.5 text-[10px] font-medium uppercase text-stone-100/55" title="Used when RuTracker has no match">fallback</span>
      </div>
    </div>
  </UiCard>
</template>
