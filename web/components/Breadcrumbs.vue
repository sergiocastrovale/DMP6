<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

const props = defineProps<{
  root: { label: string; to: string }
  labels: Record<string, string>
}>()

const route = useRoute()

const segment = computed(() => {
  const parts = route.path.replace(/\/$/, '').split('/')
  return parts.length > 2 ? parts[2] : null
})

const label = computed(() => (segment.value ? props.labels[segment.value] ?? segment.value : null))
</script>

<template>
  <nav v-if="segment" class="flex items-center gap-1.5 text-sm">
    <NuxtLink :to="root.to" class="text-ink0 transition-colors hover:text-ink-2">
      {{ root.label }}
    </NuxtLink>
    <ChevronRight :size="12" class="text-ink-4" />
    <span class="text-ink">{{ label }}</span>
  </nav>
</template>
