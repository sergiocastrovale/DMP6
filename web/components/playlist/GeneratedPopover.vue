<template>
  <Popover trigger="hover" teleport placement="bottom-end">
    <template #trigger>
      <UiButton variant="ghost" size="sm" icon-only :icon="LucideCircleHelp" aria-label="More about this playlist group" />
    </template>
    <template #content>
      <div :class="[surface.popover, 'w-72 p-3']">
        <p :class="cx('mb-2', typography.sectionLabel)">{{ title }}</p>
        <p class="text-sm text-stone-100/60">{{ text }}</p>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { LucideCircleHelp } from 'lucide-vue-next'
import { cx, surface, typography } from '~/helpers/ui'

defineProps<{
  title: string
  text: string
}>()
</script>
