<script setup lang="ts">
import type { Confidence } from '~/types/issues'
import { toneBg } from '~/helpers/ui'

const props = defineProps<{ confidence: Confidence }>()

const CONFIDENCE_TONE: Record<Confidence, keyof typeof toneBg> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
}
</script>

<template>
  <span :class="toneBg[CONFIDENCE_TONE[confidence]]" class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium">
    {{ confidence }}
  </span>
</template>
