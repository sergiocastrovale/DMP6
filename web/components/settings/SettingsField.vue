<script setup lang="ts">
defineProps<{
  label: string
  description?: string
  descriptionClass?: string
  placeholder?: string
  type?: 'text' | 'password' | 'number' | 'select'
  options?: { value: string; label: string }[]
}>()

const model = defineModel<string | number | null>()
</script>

<template>
  <UiSelect
    v-if="type === 'select' && options"
    :model-value="(model as string) ?? ''"
    :label="label"
    :description="description"
    :description-class="descriptionClass"
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
    :description-class="descriptionClass"
    :type="type === 'password' ? 'password' : type === 'number' ? 'number' : 'text'"
    :placeholder="placeholder"
    @update:model-value="model = $event"
  />
</template>
