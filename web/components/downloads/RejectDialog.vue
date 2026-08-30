<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: boolean
  title?: string | null
  heading?: string
  verb?: string
  confirmLabel?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()

const heading = computed(() => props.heading ?? 'Reject download')
const verb = computed(() => props.verb ?? 'Reject')
const confirmLabel = computed(() => props.confirmLabel ?? 'Reject & delete')
const message = computed(() => `${verb.value} ${props.title ? `"${props.title}"` : 'this download'}? The downloaded files will be deleted from disk.`)
</script>

<template>
  <ConfirmDialog
    :model-value="modelValue"
    :title="heading"
    :message="message"
    :confirm-label="confirmLabel"
    variant="danger"
    :icon="Trash2"
    @update:model-value="emit('update:modelValue', $event)"
    @confirm="emit('confirm')"
  />
</template>
