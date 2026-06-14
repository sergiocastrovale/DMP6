<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'

defineProps<{
  modelValue: boolean
  title?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()

const close = () => emit('update:modelValue', false)
</script>

<template>
  <Dialog
    :model-value="modelValue"
    title="Reject download"
    max-width="sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-5">
      <p class="text-sm text-ink-2">
        Reject <span v-if="title" class="text-ink">“{{ title }}”</span><span v-else>this download</span>?
        The downloaded files will be deleted from disk and the entry removed.
      </p>
      <div class="flex justify-end gap-2">
        <UiButton variant="ghost" @click="close">
          Cancel
        </UiButton>
        <UiButton variant="danger" :icon="Trash2" @click="emit('confirm')">
          Reject & delete
        </UiButton>
      </div>
    </div>
  </Dialog>
</template>
