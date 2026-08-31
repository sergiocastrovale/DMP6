<script setup lang="ts">
import type { Component } from 'vue'
import type { ButtonVariant } from '~/helpers/ui'

interface BarAction {
  key: string
  label: string
  icon?: Component
  // The button recipe's own union rather than a local copy of it - the copy had already drifted,
  // missing `quiet`, which is the variant the bar's own amber strip calls for.
  variant?: ButtonVariant
}

withDefaults(defineProps<{
  count: number
  loading?: boolean
  actions: BarAction[]
}>(), {
  loading: false,
})

const emit = defineEmits<{ action: [key: string], cancel: [] }>()
</script>

<template>
  <UiBulkBar :count="count" @cancel="emit('cancel')">
    <!-- Quiet + sm on purpose: the strip is already amber, so a primary (amber-filled) button on it
         reads as one flat block instead of an action. -->
    <UiButton
      v-for="action in actions"
      :key="action.key"
      size="sm"
      :icon="action.icon"
      :variant="action.variant ?? 'quiet'"
      :loading="loading"
      :title="action.label"
      @click="emit('action', action.key)"
    >
      {{ action.label }}
    </UiButton>
  </UiBulkBar>
</template>
