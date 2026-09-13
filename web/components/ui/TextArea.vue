<script setup lang="ts">
import { cx, form } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  modelValue: string
  label?: string
  description?: string
  placeholder?: string
  rows?: number
  autofocus?: boolean
  required?: boolean
  disabled?: boolean
  error?: string
}>(), {
  label: undefined,
  description: undefined,
  placeholder: undefined,
  rows: 3,
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
    <label v-if="label" :for="fieldId" :class="form.label">{{ label }}</label>
    <p v-if="description" :class="form.hint">{{ description }}</p>
    <div class="flex flex-col gap-1.5">
      <textarea
        :id="fieldId"
        :value="modelValue"
        :placeholder="placeholder"
        :rows="rows"
        :autofocus="autofocus"
        :required="required"
        :disabled="disabled"
        :aria-invalid="!!error || undefined"
        :aria-describedby="errorId"
        :class="cx(form.input, 'h-auto py-2.5', error && form.inputInvalid, disabled && 'opacity-50 cursor-default')"
        @input="$emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
        @blur="$emit('blur')"
      />
      <p v-if="error" :id="errorId" role="alert" :class="form.error">{{ error }}</p>
    </div>
  </div>
</template>
