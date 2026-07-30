<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { PauseCircle } from 'lucide-vue-next'

const store = useDownloadsStore()
const { acquisition, paused } = storeToRefs(store)

const hoursUntil = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) {
    return 'soon'
  }
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// Idle when no source can produce a download (and not already covered by the pause banner).
const acquisitionIdle = computed(() => !!acquisition.value && !acquisition.value.canAcquire)
const idleMessage = computed(() => {
  const a = acquisition.value
  if (!a) {
    return ''
  }
  const parts: string[] = []
  if (!a.rt.enabled && !a.slsk.enabled) {
    return 'No download source enabled — turn on RuTracker or Soulseek to resume acquisition.'
  }
  if (a.rt.enabled && a.rt.remaining <= 0) {
    const resets = a.rt.resetsAt ? `, resets in ${hoursUntil(a.rt.resetsAt)}` : ''
    parts.push(`RuTracker daily search limit reached (${a.rt.used}/${a.rt.limit})${resets}`)
  }
  else if (!a.rt.enabled) {
    parts.push('RuTracker disabled')
  }
  parts.push(a.slsk.enabled ? 'Soulseek enabled' : 'Soulseek disabled')
  return `Acquisition idle — ${parts.join('; ')}.`
})
</script>

<template>
  <div
    v-if="acquisitionIdle && !paused"
    class="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-300"
  >
    <PauseCircle :size="15" />
    <span>{{ idleMessage }} Background searching is paused until a source is available.</span>
  </div>
  <div
    v-if="acquisition?.noYearMissing"
    class="flex items-center gap-2 rounded-lg border border-slate-500/40 bg-slate-500/10 px-4 py-2 text-sm text-slate-300"
  >
    <PauseCircle :size="15" />
    <span>{{ acquisition.noYearMissing }} release{{ acquisition.noYearMissing === 1 ? '' : 's' }} have no MusicBrainz release date and can never be auto-acquired.</span>
  </div>
</template>
