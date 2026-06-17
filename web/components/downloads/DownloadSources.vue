<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Magnet, Waves } from 'lucide-vue-next'

const store = useDownloadsStore()
const { sources, slskd, prowlarr, qbittorrent } = storeToRefs(store)

const find = (name: 'RUTRACKER' | 'SLSKD') => sources.value.find(s => s.name === name)

// RuTracker needs both Prowlarr (search) and qBittorrent (download); Soulseek needs slskd.
const rtConnected = computed(() => prowlarr.value.connected && qbittorrent.value.connected)
const rtHint = computed(() => {
  if (rtConnected.value) return 'Prowlarr + qBittorrent connected'
  if (!prowlarr.value.configured && !qbittorrent.value.configured) return 'not configured'
  if (!prowlarr.value.connected) return 'Prowlarr offline'
  if (!qbittorrent.value.connected) return 'qBittorrent offline'
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
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-rule bg-bg-1 px-4 py-3">
    <span class="text-xs font-semibold uppercase tracking-wider text-ink-3">Sources</span>

    <div class="flex items-center gap-2">
      <Magnet :size="15" class="text-ink-3" />
      <Switch v-model="rtEnabled">
        <span class="flex items-center gap-2">
          RuTracker
          <span class="inline-flex items-center gap-1 text-xs text-ink-3">
            <span class="size-1.5 rounded-full" :class="rtConnected ? 'bg-emerald-400' : 'bg-ink-4'" />
            {{ rtHint }}
          </span>
        </span>
      </Switch>
      <span class="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-3" title="Tried first when enabled">priority</span>
    </div>

    <div class="flex items-center gap-2">
      <Waves :size="15" class="text-ink-3" />
      <Switch v-model="slskEnabled">
        <span class="flex items-center gap-2">
          Soulseek
          <span class="inline-flex items-center gap-1 text-xs text-ink-3">
            <span class="size-1.5 rounded-full" :class="slskd.connected ? 'bg-emerald-400' : 'bg-ink-4'" />
            {{ slskHint }}
          </span>
        </span>
      </Switch>
      <span class="rounded bg-bg-3 px-1.5 py-0.5 text-[10px] font-medium uppercase text-ink-3" title="Used when RuTracker has no match">fallback</span>
    </div>
  </div>
</template>
