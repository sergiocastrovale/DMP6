<script setup lang="ts">
import type { ToggleOption } from '~/types/ui'
import { segmentGroup, sw } from '~/helpers/ui'

defineProps<{
  options: ToggleOption[]
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <div :class="segmentGroup" role="radiogroup">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      :tabindex="model === option.value ? 0 : -1"
      :class="sw('switchBtn', model === option.value)"
      :title="option.title"
      :aria-label="option.title"
      @click="model = option.value"
    >
      <component :is="option.icon" :size="16" />
    </button>
  </div>
</template>
