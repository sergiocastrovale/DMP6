<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { PauseCircle } from 'lucide-vue-next'

const store = useDownloadsStore()
const { acquisition, paused } = storeToRefs(store)

// Idle when downloads are switched off (and not already covered by the pause banner).
const acquisitionIdle = computed(() => !!acquisition.value && !acquisition.value.canAcquire)
</script>

<template>
  <UiBanner v-if="acquisitionIdle && !paused" tone="accent" :icon="PauseCircle">
    Downloads are switched off — turn Soulseek back on in Settings → Downloads to resume acquisition.
  </UiBanner>
  <UiBanner v-if="acquisition?.noYearMissing" tone="info" :icon="PauseCircle">
    {{ acquisition.noYearMissing }} release{{ acquisition.noYearMissing === 1 ? '' : 's' }} have no MusicBrainz release date and can never be auto-acquired.
  </UiBanner>
</template>
