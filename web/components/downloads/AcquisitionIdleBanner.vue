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
  <UiBanner v-if="acquisitionIdle && !paused" tone="accent" :icon="PauseCircle">
    {{ idleMessage }} Background searching is paused until a source is available.
  </UiBanner>
  <UiBanner v-if="acquisition?.noYearMissing" tone="info" :icon="PauseCircle">
    {{ acquisition.noYearMissing }} release{{ acquisition.noYearMissing === 1 ? '' : 's' }} have no MusicBrainz release date and can never be auto-acquired.
  </UiBanner>
</template>
