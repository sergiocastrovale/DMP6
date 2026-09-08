<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { PauseCircle } from 'lucide-vue-next'

const store = useDownloadsStore()
const { acquisition, paused } = storeToRefs(store)

// Idle when downloads are switched off via the Settings toggle specifically — environment
// unavailability (unmounted volume, unreachable slskd) gets its own banner (EnvironmentBanner)
// naming the actual cause instead of this one pointing at the wrong fix.
const acquisitionIdle = computed(() => !!acquisition.value && !acquisition.value.enabled)
</script>

<template>
  <UiBanner v-if="acquisitionIdle && !paused" tone="accent" :icon="PauseCircle">
    Downloads are switched off — turn Soulseek back on in Settings → Downloads to resume acquisition.
  </UiBanner>
  <UiBanner v-if="acquisition?.noYearMissing" tone="info" :icon="PauseCircle">
    {{ acquisition.noYearMissing }} release{{ acquisition.noYearMissing === 1 ? '' : 's' }} have no MusicBrainz release date and can never be auto-acquired.
  </UiBanner>
</template>
