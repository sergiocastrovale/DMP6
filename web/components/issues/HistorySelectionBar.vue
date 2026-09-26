<script setup lang="ts">
import { Trash2, Undo2 } from 'lucide-vue-next'

withDefaults(defineProps<{ count: number; loading: boolean; canUndo?: boolean; canClear?: boolean }>(), {
  canUndo: true,
  canClear: true,
})
const emit = defineEmits<{ clear: []; undo: []; cancel: [] }>()
</script>

<template>
  <UiBulkBar :count="count" @cancel="emit('cancel')">
    <UiButton v-if="canClear" size="sm" variant="danger" :icon="Trash2" :loading="loading" @click="emit('clear')">
      Clear selected
    </UiButton>
    <UiButton v-if="canUndo" size="sm" variant="quiet" :icon="Undo2" :loading="loading" @click="emit('undo')">
      Undo selected
    </UiButton>
  </UiBulkBar>
</template>
