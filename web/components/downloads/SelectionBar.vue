<script setup lang="ts">
import type { BarAction } from '~/types/ui'

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
