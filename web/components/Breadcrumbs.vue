<script setup lang="ts">
import { ChevronRight } from 'lucide-vue-next'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = defineProps<{
  root: { label: string, to: string }
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
  <nav v-if="segment" aria-label="Breadcrumb" class="flex items-center gap-1.5 text-sm">
    <NuxtLink :to="root.to" class="text-stone-100/40 transition-colors duration-150 hover:text-stone-100/60">
      {{ root.label }}
    </NuxtLink>
    <ChevronRight :size="12" :stroke-width="ICON_STROKE_WIDTH" class="text-stone-100/30" />
    <span class="text-stone-100" aria-current="page">{{ label }}</span>
  </nav>
</template>
