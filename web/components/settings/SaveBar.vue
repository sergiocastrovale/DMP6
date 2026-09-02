<script setup lang="ts">
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-vue-next'

defineProps<{
  saving: boolean
  saved: boolean
  error: string
}>()
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <slot />
    <p aria-live="polite" class="flex items-center gap-1.5 text-sm">
      <span v-if="saving" class="flex items-center gap-1.5 text-stone-100/55">
        <Loader2 :size="15" class="animate-spin" /> Saving…
      </span>
      <span v-else-if="saved" class="flex items-center gap-1.5 text-success">
        <CheckCircle2 :size="15" /> Saved
      </span>
      <span v-if="error" class="flex items-center gap-1.5 text-danger">
        <AlertCircle :size="15" /> {{ error }}
      </span>
    </p>
  </div>
</template>
