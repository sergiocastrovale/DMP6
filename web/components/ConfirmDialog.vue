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
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
}>(), {
  variant: 'primary',
  size: 'sm',
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
    :size="size"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <template #content>
      <div class="flex flex-col gap-3 text-base text-stone-100/60">
        <div v-if="message">{{ message }}</div>
        <div v-if="note">{{ note }}</div>
        <slot />
        <div class="flex justify-end gap-2.5 mt-5">
          <UiButton variant="secondary" @click="close">
            Cancel
          </UiButton>
          <UiButton :variant="variant" :icon="icon" @click="emit('confirm')">
            {{ confirmLabel ?? 'Confirm' }}
          </UiButton>
        </div>
      </div>
    </template>
  </Dialog>
</template>
