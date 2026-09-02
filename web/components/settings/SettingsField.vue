<script setup lang="ts">
defineProps<{
  label: string
  description?: string
  placeholder?: string
  type?: 'text' | 'password' | 'number' | 'select'
  options?: { value: string; label: string }[]
  error?: string
  disabled?: boolean
}>()

defineEmits<{ blur: [] }>()

const model = defineModel<string | number | null>()
</script>

<template>
  <UiSelect
    v-if="type === 'select' && options"
    :model-value="(model as string) ?? ''"
    :label="label"
    :description="description"
    :error="error"
    :disabled="disabled"
    @update:model-value="model = $event"
  >
    <option value="">- use env default -</option>
    <option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
  </UiSelect>

  <UiTextField
    v-else
    :model-value="(model as string) ?? ''"
    :label="label"
    :description="description"
    :error="error"
    :disabled="disabled"
    :type="type === 'password' ? 'password' : type === 'number' ? 'number' : 'text'"
    :placeholder="placeholder"
    @update:model-value="model = $event"
    @blur="$emit('blur')"
  />
</template>
