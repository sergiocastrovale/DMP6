<script setup lang="ts">
interface Props {
  minScore: number | null
  maxScore: number | null
}

const props = defineProps<Props>()
const emit = defineEmits<{
  'update:minScore': [value: number | null]
  'update:maxScore': [value: number | null]
}>()

const localMin = ref(props.minScore ?? 0)
const localMax = ref(props.maxScore ?? 100)
const showPopover = ref(false)

watch(() => props.minScore, (val) => {
  if (val !== null) localMin.value = val
})
watch(() => props.maxScore, (val) => {
  if (val !== null) localMax.value = val
})

function apply() {
  emit('update:minScore', localMin.value === 0 ? null : localMin.value)
  emit('update:maxScore', localMax.value === 100 ? null : localMax.value)
  showPopover.value = false
}

function reset() {
  localMin.value = 0
  localMax.value = 100
  emit('update:minScore', null)
  emit('update:maxScore', null)
  showPopover.value = false
}

const isActive = computed(() => props.minScore !== null || props.maxScore !== null)
</script>

<template>
  <div class="relative">
    <button
      class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
      :class="isActive
        ? 'border-amber-500 bg-amber-500 text-zinc-950'
        : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-50'"
      @click="showPopover = !showPopover"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="21" x2="14" y1="4" y2="4" />
        <line x1="10" x2="3" y1="4" y2="4" />
        <line x1="21" x2="12" y1="12" y2="12" />
        <line x1="8" x2="3" y1="12" y2="12" />
        <line x1="21" x2="16" y1="20" y2="20" />
        <line x1="12" x2="3" y1="20" y2="20" />
        <line x1="14" x2="14" y1="2" y2="6" />
        <line x1="8" x2="8" y1="10" y2="14" />
        <line x1="16" x2="16" y1="18" y2="22" />
      </svg>
      Match Score
      <span v-if="isActive" class="ml-1">
        {{ minScore ?? 0 }}%-{{ maxScore ?? 100 }}%
      </span>
    </button>

    <!-- Popover -->
    <div
      v-if="showPopover"
      class="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-xl"
    >
      <p class="mb-3 text-xs font-semibold uppercase text-zinc-500">
        Match Score Range
      </p>

      <!-- Min slider -->
      <div class="mb-4">
        <label class="mb-1 flex justify-between text-xs text-zinc-400">
          <span>Minimum</span>
          <span class="font-medium text-zinc-50">{{ localMin }}%</span>
        </label>
        <input
          v-model.number="localMin"
          type="range"
          min="0"
          max="100"
          step="5"
          class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-amber-500"
        >
      </div>

      <!-- Max slider -->
      <div class="mb-4">
        <label class="mb-1 flex justify-between text-xs text-zinc-400">
          <span>Maximum</span>
          <span class="font-medium text-zinc-50">{{ localMax }}%</span>
        </label>
        <input
          v-model.number="localMax"
          type="range"
          min="0"
          max="100"
          step="5"
          class="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-amber-500"
        >
      </div>

      <!-- Actions -->
      <div class="flex justify-end gap-2">
        <button
          class="rounded px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-50 transition-colors"
          @click="reset"
        >
          Reset
        </button>
        <button
          class="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-amber-600 transition-colors"
          @click="apply"
        >
          Apply
        </button>
      </div>
    </div>
  </div>
</template>
