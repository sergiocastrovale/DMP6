<script setup lang="ts">
import type { Component } from 'vue'

interface BarAction {
  key: string
  label: string
  icon?: Component
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

withDefaults(defineProps<{
  count: number
  loading?: boolean
  actions: BarAction[]
}>(), {
  loading: false,
})

const emit = defineEmits<{ action: [key: string] }>()
</script>

<template>
  <UiBulkBar :count="count">
    <UiButton
      v-for="action in actions"
      :key="action.key"
      :icon="action.icon"
      :variant="action.variant ?? 'primary'"
      :loading="loading"
      :title="action.label"
      @click="emit('action', action.key)"
    >
      {{ action.label }}
    </UiButton>
  </UiBulkBar>
</template>
