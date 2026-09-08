<script setup lang="ts">
import { storeToRefs } from 'pinia'

// This instance's environment (mounted volumes, ffmpeg, slskd) may be fine for reading the shared
// queue over the DB but unable to physically download or merge — e.g. a dev box pointed at the
// prod DB without the NAS's downloads volume mounted. States the cause once at the top of the page
// instead of letting every disabled button explain it individually.
const store = useDownloadsStore()
const { capabilitiesChecked, environmentBlockReasons } = storeToRefs(store)
</script>

<template>
  <UiBanner v-if="capabilitiesChecked && environmentBlockReasons.length" tone="danger">
    <div class="mb-1 text-lg font-medium">Some operations are unavailable!</div>
    <ul class="mt-1 list-disc pl-5">
      <li v-for="reason in environmentBlockReasons" :key="reason">{{ reason }}</li>
    </ul>
  </UiBanner>
</template>
