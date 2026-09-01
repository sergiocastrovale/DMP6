<script setup lang="ts">
import { cx, tile } from '~/helpers/ui'

withDefaults(defineProps<{
  size?: 'sm' | 'full'
}>(), {
  size: 'full',
})

const SIZE: Record<'sm' | 'full', string> = {
  sm: 'relative size-10 shrink-0 overflow-hidden rounded-md bg-stone-800',
  full: cx('relative', tile.art),
}
</script>

<template>
  <div :class="SIZE[size]">
    <slot />
  </div>
</template>
