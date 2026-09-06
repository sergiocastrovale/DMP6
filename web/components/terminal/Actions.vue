<script setup lang="ts">
import { X } from 'lucide-vue-next'
import type { Maximize, Minimize } from 'lucide-vue-next'

const props = defineProps<{
  toggleLabel: string
  toggleIcon: typeof Maximize | typeof Minimize
}>()

const emit = defineEmits<{
  (e: 'toggle' | 'stop'): void
}>()
</script>

<template>
  <div class="flex items-center gap-2">
    <component :is="props.toggleIcon" :size="12" :title="props.toggleLabel" class="cursor-pointer text-stone-100/60 hover:text-white" @click="emit('toggle')" />
    <X :size="14" title="Stop and Close" class="cursor-pointer text-stone-100/60 hover:text-white" @click="emit('stop')" />
  </div>
</template>