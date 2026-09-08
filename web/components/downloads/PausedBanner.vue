<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { AlertTriangle } from 'lucide-vue-next'

const store = useDownloadsStore()
const { paused, pausedReason, freeGb, minFreeGb } = storeToRefs(store)
</script>

<template>
  <UiBanner v-if="paused" :tone="pausedReason === 'disk-full' ? 'danger' : 'accent'" :icon="AlertTriangle">
    <template v-if="pausedReason === 'disk-full'">
      Downloads auto-paused — disk full ({{ freeGb }} GB free, need {{ minFreeGb }} GB). Free space, then Continue.
    </template>
    <template v-else>All downloads paused. New downloads, catalogue scans and auto-merge are halted until you continue.</template>
  </UiBanner>
</template>
