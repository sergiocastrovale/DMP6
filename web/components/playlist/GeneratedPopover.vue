<template>
  <Popover trigger="hover">
    <template #trigger>
      <button class="text-ink-3 hover:text-ink-2 transition-colors">
        <LucideHelpCircle class="size-3.5" />
      </button>
    </template>
    <template #content>
      <div class="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
        <p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-2">{{ title }}</p>
        <p class="text-xs text-ink-2">{{ text }}</p>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { LucideHelpCircle } from 'lucide-vue-next'

defineProps<{
  title: string
  text: string
}>()
</script>
