<script setup lang="ts">
import { Network } from 'lucide-vue-next'
import { cx, surface, typography } from '~/helpers/ui'

const query = defineModel<string>('query', { required: true })
const minShared = defineModel<number>('minShared', { required: true })
const searchOpen = defineModel<boolean>('searchOpen', { required: true })

defineProps<{
  results: { id: string, name: string, slug: string }[]
  selected: { id: string, name: string } | null
  artistCount: number
  linkCount: number
}>()

defineEmits<{
  select: [artist: { id: string, name: string }]
  clear: []
  blur: []
}>()
</script>

<template>
  <UiCard padding="sm" :icon="Network" title="Artist Network" subtitle="Collaboration connections">
    <p class="text-base leading-relaxed text-stone-100/60">
      Artists connected by shared tracks. Search to focus on one artist's collaborations. Click any node to explore its network.
    </p>

    <SearchInput
      v-model="query"
      placeholder="Search artist..."
      size="md"
      clearable
      :debounce="250"
      @focus="searchOpen = true"
      @blur="$emit('blur')"
      @clear="$emit('clear')"
    >
      <template #results>
        <div
          v-if="searchOpen && results.length > 0"
          :class="cx(surface.popover, 'absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto')"
        >
          <button
            v-for="result in results"
            :key="result.id"
            type="button"
            class="w-full px-3 py-2 text-left text-base text-stone-100 transition-colors duration-150 hover:bg-stone-800"
            @mousedown.prevent="$emit('select', result)"
          >
            {{ result.name }}
          </button>
        </div>
      </template>
    </SearchInput>

    <div v-if="!selected">
      <Slider v-model="minShared" title="Min shared tracks" :min="1" :max="20" />
    </div>

    <div v-if="artistCount > 0" :class="typography.meta">
      {{ artistCount }} artists · {{ linkCount }} connections
    </div>

    <div v-if="selected" class="flex flex-col gap-1.5 text-sm text-stone-100/60">
      <div class="flex items-center gap-1.5">
        <div class="size-2.5 rounded-full bg-orange-400" />
        Selected
      </div>
    </div>
  </UiCard>
</template>
