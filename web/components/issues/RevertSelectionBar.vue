<script setup lang="ts">
import { Undo2 } from 'lucide-vue-next'

defineProps<{ count: number; loading: boolean }>()
const emit = defineEmits<{ revert: [mode: 'undo' | 'undo-resolved'] }>()
</script>

<template>
  <UiBulkBar :count="count">
    <UiButton :icon="Undo2" :loading="loading" @click="emit('revert', 'undo')">
      Undo
    </UiButton>
    <UiButton variant="secondary" :icon="Undo2" :loading="loading" @click="emit('revert', 'undo-resolved')">
      Undo (keep resolved)
    </UiButton>
  </UiBulkBar>
</template>
