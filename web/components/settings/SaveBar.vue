<script setup lang="ts">
import { Save, CheckCircle2, AlertCircle } from 'lucide-vue-next'

withDefaults(defineProps<{
  saving: boolean
  saved: boolean
  error: string
  disabled?: boolean
  label?: string
}>(), {
  disabled: false,
  label: 'Save Changes',
})

defineEmits<{ save: [] }>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <UiButton :icon="Save" :loading="saving" :disabled="disabled" @click="$emit('save')">
      {{ label }}
    </UiButton>
    <slot />
    <p aria-live="polite" class="flex items-center gap-1.5 text-sm">
      <span v-if="saved" class="flex items-center gap-1.5 text-success">
        <CheckCircle2 :size="15" /> Saved
      </span>
      <span v-if="error" class="flex items-center gap-1.5 text-danger">
        <AlertCircle :size="15" /> {{ error }}
      </span>
    </p>
  </div>
</template>
