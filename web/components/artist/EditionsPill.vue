<script setup lang="ts">
import { cx, markerPill } from '~/helpers/ui'

defineProps<{
  count: number
}>()
</script>

<template>
  <span :class="cx('absolute inset-y-0 left-0 w-px my-2 xl:hidden', markerPill.accent.rule)" />
  <span :class="cx('absolute right-full top-12 hidden translate-x-5.75 -translate-y-1/2 -rotate-90 whitespace-nowrap rounded-sm rounded-b-none border border-b-0 px-2 py-0.5 text-2xs font-medium xl:block', markerPill.accent.tab)">
    {{ count }} editions
  </span>
</template>
