<script setup lang="ts">
import type { Component } from 'vue'

const props = withDefaults(defineProps<{
  modelValue: boolean
  title: string
  message?: string
  note?: string
  confirmLabel?: string
  variant?: 'primary' | 'danger'
  icon?: Component
}>(), {
  variant: 'primary',
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()

const close = () => emit('update:modelValue', false)
</script>

<template>
  <Dialog
    :model-value="modelValue"
    :title="title"
    max-width="sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-5">
      <p v-if="message" class="text-base text-stone-100/60">{{ message }}</p>
      <p v-if="note" class="rounded-lg border border-stone-100/6 bg-stone-950 px-3 py-2 text-sm text-stone-100/55">{{ note }}</p>
      <slot />
      <div class="flex justify-end gap-2.5">
        <UiButton variant="secondary" @click="close">
          Cancel
        </UiButton>
        <UiButton :variant="variant" :icon="icon" @click="emit('confirm')">
          {{ confirmLabel ?? 'Confirm' }}
        </UiButton>
      </div>
    </div>
  </Dialog>
</template>
