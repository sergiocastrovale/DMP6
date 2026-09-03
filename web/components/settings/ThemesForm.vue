<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { cx } from '~/helpers/ui'

const { accent, size, themes, uiSizes, setAccent, setSize } = useTheme()

// Slider works in indices; the stored value is the size id, so translate at the boundary.
const sizeIndex = computed({
  get: () => Math.max(0, uiSizes.findIndex(s => s.id === size.value)),
  set: (index: number) => setSize(uiSizes[index]!.id),
})

const sizeStops = uiSizes.map(s => s.label)
</script>

<template>
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Theme">
      <span class="text-base font-medium text-stone-100">Accent color</span>
      <div class="flex flex-wrap gap-3 mb-4">
        <button
          v-for="t in themes"
          :key="t.id"
          type="button"
          :aria-label="t.label"
          :aria-pressed="accent === t.id"
          :title="t.label"
          :class="cx(
            'grid size-12 place-items-center rounded-lg border-2 transition-colors duration-150 cursor-pointer',
            'outline-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-100',
            accent === t.id ? 'border-stone-100' : 'border-stone-100/10 hover:border-stone-100/40',
          )"
          :style="{ backgroundColor: `var(${t.swatchVar})` }"
          @click="setAccent(t.id)"
        >
          <Check v-if="accent === t.id" :size="26" class="text-stone-950" />
        </button>
      </div>
      
      <Slider
        v-model="sizeIndex"
        title="Text size"
        left-label="Smaller"
        right-label="Larger"
        :max="uiSizes.length - 1"
        :stops="sizeStops"
      />
    </UiCard>
  </div>
</template>
