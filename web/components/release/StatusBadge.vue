<script setup lang="ts">
import type { ReleaseStatus } from '~/types/release'
import { getStatus } from '~/helpers/constants'
import { toneBg } from '~/helpers/ui'

const props = defineProps<{
  status: ReleaseStatus
  trackCount?: number
  localTrackCount?: number
}>()

const status = computed(() => getStatus(props.status))
</script>

<template>
  <span :class="toneBg[status.tone]" class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
    {{ status.label }}
  </span>
</template>
