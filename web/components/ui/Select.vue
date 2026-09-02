<script setup lang="ts">
import { ChevronDown } from 'lucide-vue-next'
import { cx, form, ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  modelValue: string
  label?: string
  description?: string
  error?: string
}>(), {
  label: undefined,
  description: undefined,
  error: undefined,
})

defineEmits<{ 'update:modelValue': [value: string] }>()

const fieldId = useId()
const errorId = computed(() => props.error ? `${fieldId}-error` : undefined)
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="fieldId" :class="form.label">{{ label }}</label>
    <p v-if="description" :class="form.hint">{{ description }}</p>
    <div class="mt-auto flex flex-col gap-1.5">
      <div class="relative">
        <select
          :id="fieldId"
          :value="modelValue"
          :aria-invalid="!!error || undefined"
          :aria-describedby="errorId"
          :class="cx(form.select, error && form.inputInvalid)"
          @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
        >
          <slot />
        </select>
        <ChevronDown :size="16" :stroke-width="ICON_STROKE_WIDTH" class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-stone-100/50" />
      </div>
      <p v-if="error" :id="errorId" role="alert" :class="form.error">{{ error }}</p>
    </div>
  </div>
</template>
