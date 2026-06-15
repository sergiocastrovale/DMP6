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

const close = () => emit('update:modelValue', false)
</script>

<template>
  <Dialog
    :model-value="modelValue"
    :title="heading"
    max-width="sm"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="space-y-5">
      <p class="text-sm text-ink-2">
        {{ verb }} <span v-if="title" class="text-ink">“{{ title }}”</span><span v-else>this download</span>?
        The downloaded files will be deleted from disk.
      </p>
      <div class="flex justify-end gap-2">
        <UiButton variant="ghost" @click="close">
          Cancel
        </UiButton>
        <UiButton variant="danger" :icon="Trash2" @click="emit('confirm')">
          {{ confirmLabel }}
        </UiButton>
      </div>
    </div>
  </Dialog>
</template>
