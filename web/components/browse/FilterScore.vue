<script setup lang="ts">
import type { ScoreRangeFilterProps } from '~/types/ui'
import { SlidersHorizontal, X } from 'lucide-vue-next'
import { scoreRanges } from '~/helpers/constants'
import { cx, ICON_STROKE_WIDTH, surface } from '~/helpers/ui'

const props = defineProps<ScoreRangeFilterProps>()
const emit = defineEmits<{
  'update:range': [min: number | null, max: number | null]
}>()

const { open: showDropdown, triggerRef, close } = useDismissable()

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
  close()
}

const clear = () => {
  emit('update:range', null, null)
  close()
}
</script>

<template>
  <div class="relative">
    <!-- Two separate controls sharing one pill, not one <button> nesting another - a clear icon
         inside the trigger button would be unreachable by keyboard and invalid HTML. -->
    <div
      :class="cx(
        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors duration-150',
        isActive ? 'border-amber-400/45 bg-amber-400/10 text-amber-400' : 'border-stone-100/10 bg-stone-900 text-stone-100/60 hover:text-stone-100',
      )"
    >
      <button
        ref="triggerRef"
        type="button"
        aria-haspopup="listbox"
        :aria-expanded="showDropdown"
        class="flex items-center gap-1.5"
        @click="showDropdown = !showDropdown"
      >
        <SlidersHorizontal :size="12" :stroke-width="ICON_STROKE_WIDTH" />
        {{ activeLabel || 'Match Score' }}
      </button>
      <button v-if="isActive" type="button" aria-label="Clear match score filter" class="hover:text-stone-100" @click="clear">
        <X :size="12" :stroke-width="ICON_STROKE_WIDTH" />
      </button>
    </div>

    <div
      v-if="showDropdown"
      role="listbox"
      :class="cx(surface.popover, 'absolute left-0 top-full z-20 mt-1 w-44 p-1')"
    >
      <button
        v-for="range in scoreRanges"
        :key="range.label"
        type="button"
        role="option"
        :aria-selected="minScore === range.min && maxScore === range.max"
        :class="cx(
          'flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-stone-800',
          minScore === range.min && maxScore === range.max ? 'text-amber-400' : 'text-stone-100/60',
        )"
        @click="select(range)"
      >
        <span class="size-2.5 shrink-0 rounded-sm" :class="range.color" />
        {{ range.label }}
      </button>
    </div>

    <div v-if="showDropdown" class="fixed inset-0 z-10" @click="close" />
  </div>
</template>
