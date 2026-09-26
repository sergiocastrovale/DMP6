<script setup lang="ts">
import type { Choice } from '~/helpers/downloadSettingsForm'

const model = defineModel<Choice>({ required: true })

defineProps<{
  label: string
  description: string
  // The environment variable a blank ("default") choice falls back to.
  env: string
  disabled?: boolean
}>()

// Fires after the model was updated, so the parent can save the new value.
const emit = defineEmits<{ change: [] }>()

const onUpdate = (value: string) => {
  model.value = value as Choice
  emit('change')
}
</script>

<template>
  <UiSelect
    :model-value="model"
    :label="label"
    :description="description"
    :disabled="disabled"
    @update:model-value="onUpdate"
  >
    <option value="default">- use env default ({{ env }}) -</option>
    <option value="on">On</option>
    <option value="off">Off</option>
  </UiSelect>
</template>
