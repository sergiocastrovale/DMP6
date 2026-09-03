<script setup lang="ts">
import { Check } from 'lucide-vue-next'
import { cx } from '~/helpers/ui'

const { theme, themes, setTheme } = useTheme()
</script>

<template>
  <div class="flex w-full max-w-7xl flex-col gap-6">
    <UiCard title="Theme">
      <div class="flex flex-wrap gap-3">
        <button
          v-for="t in themes"
          :key="t.id"
          type="button"
          :aria-label="t.label"
          :aria-pressed="theme === t.id"
          :title="t.label"
          :class="cx(
            'grid size-16 place-items-center rounded-lg border-2 transition-colors duration-150 cursor-pointer',
            'outline-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-100',
            theme === t.id ? 'border-stone-100' : 'border-stone-100/10 hover:border-stone-100/40',
          )"
          :style="{ backgroundColor: `var(${t.swatchVar})` }"
          @click="setTheme(t.id)"
        >
          <Check v-if="theme === t.id" :size="26" class="text-stone-950" />
        </button>
      </div>
    </UiCard>
  </div>
</template>
