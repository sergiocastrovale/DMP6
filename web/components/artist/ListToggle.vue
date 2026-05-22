<script setup lang="ts">
import type { Component } from 'vue'

interface ToggleOption {
  value: string
  icon: Component
  title: string
}

defineProps<{
  options: ToggleOption[]
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="flex items-center rounded-lg border border-rule bg-bg-1">
    <button
      v-for="(option, index) in options"
      :key="option.value"
      type="button"
      class="px-2.5 py-1.5 transition-colors"
      :class="[
        model === option.value ? 'bg-bg-3 text-ink' : 'text-ink-2 hover:text-ink',
        index === 0 ? 'rounded-l-lg' : '',
        index === options.length - 1 ? 'rounded-r-lg' : '',
      ]"
      :title="option.title"
      @click="model = option.value"
    >
      <component :is="option.icon" :size="16" />
    </button>
  </div>
</template>
