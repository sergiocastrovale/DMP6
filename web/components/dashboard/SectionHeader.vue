<script setup lang="ts">
import { typography } from '~/helpers/ui'

defineProps<{
  title: string
}>()
</script>

<template>
  <div class="flex items-end justify-between gap-4 flex-wrap pb-4 my-5 border-b-2 border-stone-100/6">
    <h2 :class="[typography.h2, 'leading-none']">
      {{ title }}
    </h2>
  </div>
</template>
