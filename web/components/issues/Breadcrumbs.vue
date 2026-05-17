<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'

const route = useRoute()

const LABELS: Record<string, string> = {
  corrupted: 'Corrupted TPE2',
  unsplit: 'Unsplit Artists',
  orphans: 'Orphans',
  duplicates: 'Duplicates',
  missing: 'Missing Metadata',
  enrichment: 'Enrichment',
  history: 'Fix History',
}

const segment = computed(() => {
  const parts = route.path.replace(/\/$/, '').split('/')
  return parts.length > 2 ? parts[2] : null
})

const label = computed(() => (segment.value ? LABELS[segment.value] ?? segment.value : null))
</script>

<template>
  <nav v-if="segment" class="flex items-center gap-1.5 text-sm">
    <NuxtLink to="/issues" class="text-zinc-500 transition-colors hover:text-zinc-300">
      Issues
    </NuxtLink>
    <ChevronRight :size="12" class="text-zinc-700" />
    <span class="text-zinc-200">{{ label }}</span>
  </nav>
</template>
