<template>
  <Popover trigger="hover">
    <template #trigger>
      <UiButton variant="ghost" size="sm" icon-only :icon="LucideCircleHelp" aria-label="More about this playlist group" />
    </template>
    <template #content>
      <div :class="[surface.popover, 'absolute left-0 top-full z-20 mt-1 w-72 p-3']">
        <p class="mb-2 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">{{ title }}</p>
        <p class="text-sm text-stone-100/60">{{ text }}</p>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { LucideCircleHelp } from 'lucide-vue-next'
import { surface } from '~/helpers/ui'

defineProps<{
  title: string
  text: string
}>()
</script>
