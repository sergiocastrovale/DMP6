<script setup lang="ts">
import { SlidersHorizontal, X } from 'lucide-vue-next'
import { scoreRanges } from '~/helpers/constants'

interface Props {
  minScore: number | null
  maxScore: number | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:range': [min: number | null, max: number | null]
}>()

const showDropdown = ref(false)

const isActive = computed(() => props.minScore !== null || props.maxScore !== null)

const activeLabel = computed(() => {
  if (!isActive.value) {
    return null
  }
  const match = scoreRanges.find(r => r.min === props.minScore && r.max === props.maxScore)
  return match ? match.label : `${props.minScore ?? 0}%–${props.maxScore ?? 100}%`
})

const select = (range: typeof scoreRanges[number]) => {
  emit('update:range', range.min, range.max)
  showDropdown.value = false
}

const clear = () => {
  emit('update:range', null, null)
  showDropdown.value = false
}
</script>

<template>
  <div class="relative">
    <button
      class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
      :class="isActive
        ? 'border-amber-500 bg-amber-500/10 text-amber-400'
        : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-50'"
      @click="showDropdown = !showDropdown"
    >
      <SlidersHorizontal :size="12" />
      {{ activeLabel || 'Match Score' }}
      <X v-if="isActive" :size="12" class="ml-1" @click.stop="clear" />
    </button>

    <div
      v-if="showDropdown"
      class="absolute left-0 top-full z-20 mt-1 w-44 rounded-lg border border-zinc-700 bg-zinc-900 p-1 shadow-lg"
    >
      <button
        v-for="range in scoreRanges"
        :key="range.label"
        class="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs transition-colors hover:bg-zinc-800"
        :class="minScore === range.min && maxScore === range.max ? 'text-amber-400' : 'text-zinc-300'"
        @click="select(range)"
      >
        <span class="size-2.5 shrink-0 rounded-sm" :class="range.color" />
        {{ range.label }}
      </button>
    </div>
  </div>
</template>
