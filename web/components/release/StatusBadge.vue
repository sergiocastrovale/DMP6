<script setup lang="ts">
import type { ReleaseStatus } from '~/types/release'
import { getStatus } from '~/helpers/constants'

const props = defineProps<{
  status: ReleaseStatus
  trackCount?: number
  localTrackCount?: number
}>()

const status = computed(() => getStatus(props.status))
</script>

<template>
  <UiBadge :tone="status.tone">
    {{ status.label }}
  </UiBadge>
</template>
