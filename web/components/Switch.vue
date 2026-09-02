<script setup lang="ts">
import { cx } from '~/helpers/ui'

const model = defineModel<boolean>({ required: true })
const props = withDefaults(defineProps<{ label?: string; disabled?: boolean }>(), { disabled: false })
</script>

<template>
  <label
    :class="cx(
      'flex items-center gap-2.5 text-base text-stone-100/60 select-none',
      disabled ? 'cursor-default opacity-50' : 'cursor-pointer',
    )"
  >
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      :disabled="disabled"
      :class="cx(
        'relative inline-flex h-[19px] w-[34px] shrink-0 rounded-full border transition-colors duration-150',
        model ? 'bg-amber-400 border-amber-400' : 'bg-stone-700 border-stone-100/10',
        disabled && 'cursor-default',
      )"
      @click="!props.disabled && (model = !model)"
    >
      <span
        :class="cx(
          'absolute top-0.5 left-0.5 size-[15px] rounded-full bg-stone-100 shadow-md transition-transform duration-150',
          model && 'translate-x-[15px]',
        )"
      />
    </button>
    <span v-if="label">{{ label }}</span>
    <slot v-else />
  </label>
</template>
