<script setup lang="ts">
import { Trash2, Undo2 } from 'lucide-vue-next'

defineProps<{ count: number; loading: boolean }>()
const emit = defineEmits<{ clear: []; undo: []; cancel: [] }>()
</script>

<template>
  <UiBulkBar :count="count" @cancel="emit('cancel')">
    <UiButton size="sm" variant="danger" :icon="Trash2" :loading="loading" @click="emit('clear')">
      Clear selected
    </UiButton>
    <UiButton size="sm" variant="quiet" :icon="Undo2" :loading="loading" @click="emit('undo')">
      Undo selected
    </UiButton>
  </UiBulkBar>
</template>
