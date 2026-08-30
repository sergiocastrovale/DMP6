<script setup lang="ts">
import { Check, Minus } from 'lucide-vue-next'
import { cx, form } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  modelValue: boolean
  indeterminate?: boolean
  label?: string
  disabled?: boolean
}>(), {
  indeterminate: false,
  disabled: false,
})

defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const inputRef = ref<HTMLInputElement>()

// `indeterminate` has no HTML attribute form - it only ever exists as a DOM property, so it has
// to be set imperatively whenever it (or the element itself) changes.
watchEffect(() => {
  if (inputRef.value) {
    inputRef.value.indeterminate = props.indeterminate
  }
})
</script>

<template>
  <label :class="cx('inline-flex items-center gap-2.5 select-none', disabled ? 'cursor-default opacity-40' : 'cursor-pointer')">
    <span :class="form.checkbox">
      <input
        ref="inputRef"
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        class="absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-default"
        @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
      >
      <Check v-if="modelValue && !indeterminate" :size="12" :stroke-width="2.4" class="pointer-events-none text-on-accent" />
      <Minus v-else-if="indeterminate" :size="12" :stroke-width="2.4" class="pointer-events-none text-on-accent" />
    </span>
    <span v-if="label" class="text-base text-stone-100/60">{{ label }}</span>
    <slot v-else />
  </label>
</template>
