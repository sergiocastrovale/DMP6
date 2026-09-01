<script setup lang="ts">
withDefaults(defineProps<{
  size?: 'page' | 'inline'
  label?: string
}>(), {
  size: 'page',
})

const PADDING: Record<'page' | 'inline', string> = {
  page: 'py-20',
  inline: 'py-8',
}

const ICON_SIZE: Record<'page' | 'inline', number> = {
  page: 24,
  inline: 20,
}
</script>

<template>
  <div
    role="status"
    aria-live="polite"
    class="flex items-center justify-center gap-2"
    :class="PADDING[size]"
  >
    <UiSpinner :size="ICON_SIZE[size]" />
    <span v-if="label" class="text-base text-stone-100/60">{{ label }}</span>
    <span v-else class="sr-only">Loading…</span>
  </div>
</template>
