<script setup lang="ts">
import { cx, form } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  type?: string
  placeholder?: string
  autocomplete?: string
  error?: string
}>(), {
  type: 'text',
  placeholder: undefined,
  autocomplete: undefined,
  error: undefined,
})

defineEmits<{ 'update:modelValue': [value: string] }>()

const fieldId = useId()
const errorId = computed(() => props.error ? `${fieldId}-error` : undefined)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="fieldId" :class="form.label">{{ label }}</label>
    <input
      :id="fieldId"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :autocomplete="autocomplete"
      :aria-invalid="!!error || undefined"
      :aria-describedby="errorId"
      :class="cx(form.input, error && form.inputInvalid)"
      @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >
    <p v-if="error" :id="errorId" role="alert" :class="form.error">{{ error }}</p>
  </div>
</template>
