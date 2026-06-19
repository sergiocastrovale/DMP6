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
    <div class="space-y-5">
      <p v-if="message" class="text-sm text-ink-2">{{ message }}</p>
      <p v-if="note" class="rounded-lg border border-rule bg-bg-2 px-3 py-2 text-sm text-ink-3">{{ note }}</p>
      <slot />
      <div class="flex justify-end gap-2">
        <UiButton variant="ghost" @click="close">
          Cancel
        </UiButton>
        <UiButton :variant="variant" :icon="icon" @click="emit('confirm')">
          {{ confirmLabel ?? 'Confirm' }}
        </UiButton>
      </div>
    </div>
  </Dialog>
</template>
