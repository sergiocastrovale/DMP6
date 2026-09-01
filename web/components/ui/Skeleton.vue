<script setup lang="ts">
import { cx } from '~/helpers/ui'

withDefaults(defineProps<{
  w?: string
  h?: string
  shape?: 'rect' | 'pill' | 'tile'
}>(), {
  w: 'w-full',
  h: 'h-4',
  shape: 'rect',
})

const SHAPE: Record<'rect' | 'pill' | 'tile', string> = {
  rect: 'rounded',
  pill: 'rounded-full',
  tile: 'aspect-square rounded-lg',
}
</script>

<template>
  <div :class="cx('animate-pulse bg-stone-800', SHAPE[shape], shape === 'tile' ? w : cx(w, h))" />
</template>
