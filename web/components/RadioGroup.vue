<script setup lang="ts">
interface RadioOption {
  value: string
  label: string
}

defineProps<{
  options: RadioOption[]
}>()

const model = defineModel<string>({ required: true })
</script>

<template>
  <div class="inline-flex rounded-lg bg-bg-2 p-1">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
      :class="model === option.value
        ? 'bg-bg-3 text-ink'
        : 'text-ink-2 hover:text-ink-2'"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
