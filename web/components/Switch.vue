<script setup lang="ts">
const model = defineModel<boolean>({ required: true })
defineProps<{ label?: string }>()
</script>

<template>
  <label class="flex cursor-pointer items-center gap-2 text-sm text-ink-2 select-none">
    <button
      role="switch"
      :aria-checked="model"
      class="relative h-5 w-9 rounded-full transition-colors"
      :class="model ? 'bg-accent' : 'bg-bg-3'"
      @click="model = !model"
    >
      <span
        class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform"
        :class="model && 'translate-x-4'"
      />
    </button>
    <span v-if="label">{{ label }}</span>
    <slot v-else />
  </label>
</template>
