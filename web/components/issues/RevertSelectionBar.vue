<script setup lang="ts">
import { Undo2 } from 'lucide-vue-next'

defineProps<{ count: number; loading: boolean }>()
const emit = defineEmits<{ revert: [mode: 'undo' | 'undo-resolved'], cancel: [] }>()
</script>

<template>
  <UiBulkBar :count="count" @cancel="emit('cancel')">
    <UiButton size="sm" variant="quiet" :icon="Undo2" :loading="loading" @click="emit('revert', 'undo')">
      Undo
    </UiButton>
    <UiButton size="sm" variant="quiet" :icon="Undo2" :loading="loading" @click="emit('revert', 'undo-resolved')">
      Undo (keep resolved)
    </UiButton>
  </UiBulkBar>
</template>
