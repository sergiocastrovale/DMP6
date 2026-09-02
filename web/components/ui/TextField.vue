<script setup lang="ts">
import { cx, form } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  modelValue: string
  label: string
  description?: string
  type?: string
  placeholder?: string
  autocomplete?: string
  autofocus?: boolean
  required?: boolean
  disabled?: boolean
  error?: string
}>(), {
  description: undefined,
  type: 'text',
  placeholder: undefined,
  autocomplete: undefined,
  autofocus: false,
  required: false,
  disabled: false,
  error: undefined,
})

defineEmits<{ 'update:modelValue': [value: string]; blur: [] }>()

const fieldId = useId()
const errorId = computed(() => props.error ? `${fieldId}-error` : undefined)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="fieldId" :class="form.label">{{ label }}</label>
    <p v-if="description" :class="form.hint">{{ description }}</p>
    <div class="mt-auto flex flex-col gap-1.5">
      <input
        :id="fieldId"
        :type="type"
        :value="modelValue"
        :placeholder="placeholder"
        :autocomplete="autocomplete"
        :autofocus="autofocus"
        :required="required"
        :disabled="disabled"
        :aria-invalid="!!error || undefined"
        :aria-describedby="errorId"
        :class="cx(form.input, error && form.inputInvalid, disabled && 'opacity-50 cursor-default')"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @blur="$emit('blur')"
      >
      <p v-if="error" :id="errorId" role="alert" :class="form.error">{{ error }}</p>
    </div>
  </div>
</template>
