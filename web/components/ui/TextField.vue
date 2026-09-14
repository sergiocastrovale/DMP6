<script setup lang="ts">
import { Eye, EyeOff } from 'lucide-vue-next'
import { cx, form, iconButton, ICON_STROKE_WIDTH } from '~/helpers/ui'

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

const isPassword = computed(() => props.type === 'password')
const revealed = ref(false)
const inputType = computed(() => isPassword.value && revealed.value ? 'text' : props.type)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="fieldId" :class="form.label">{{ label }}</label>
    <p v-if="description" :class="form.hint">{{ description }}</p>
    <div class="mt-auto flex flex-col gap-1.5">
      <div class="relative">
        <input
          :id="fieldId"
          :type="inputType"
          :value="modelValue"
          :placeholder="placeholder"
          :autocomplete="autocomplete"
          :autofocus="autofocus"
          :required="required"
          :disabled="disabled"
          :aria-invalid="!!error || undefined"
          :aria-describedby="errorId"
          :class="cx(form.input, isPassword && 'pr-10', error && form.inputInvalid, disabled && 'opacity-50 cursor-default')"
          @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
          @blur="$emit('blur')"
        >
        <button
          v-if="isPassword"
          type="button"
          tabindex="-1"
          :aria-label="revealed ? 'Hide password' : 'Show password'"
          :class="cx(iconButton, 'absolute right-1.5 top-1/2 -translate-y-1/2 size-7')"
          @click="revealed = !revealed"
        >
          <EyeOff v-if="revealed" :size="17" :stroke-width="ICON_STROKE_WIDTH" />
          <Eye v-else :size="17" :stroke-width="ICON_STROKE_WIDTH" />
        </button>
      </div>
      <p v-if="error" :id="errorId" role="alert" :class="form.error">{{ error }}</p>
    </div>
  </div>
</template>
