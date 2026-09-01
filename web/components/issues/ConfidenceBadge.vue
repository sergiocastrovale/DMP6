<script setup lang="ts">
import type { Confidence } from '~/types/issues'
import type { Tone } from '~/helpers/ui'

const props = defineProps<{ confidence: Confidence }>()

const CONFIDENCE_TONE: Record<Confidence, Tone> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
}
</script>

<template>
  <UiBadge :tone="CONFIDENCE_TONE[confidence]">
    {{ confidence }}
  </UiBadge>
</template>
