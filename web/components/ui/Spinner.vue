<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

withDefaults(defineProps<{
  size?: number
}>(), {
  size: 20,
})
</script>

<template>
  <Loader2 :size="size" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-stone-100/55" aria-hidden="true" />
</template>
