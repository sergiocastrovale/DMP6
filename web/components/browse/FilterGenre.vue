<script setup lang="ts">
import { Tag, X } from 'lucide-vue-next'
import { cx, ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = defineProps<{
  active: string | null
}>()

const emit = defineEmits<{
  select: [genre: string | null]
}>()

const { data: genres } = useFetch<{ id: string, name: string, artistCount: number }[]>('/api/genres')
const showDropdown = ref(false)
const search = ref('')
const triggerRef = ref<HTMLElement>()

const filtered = computed(() => {
  if (!genres.value) { return [] }
  if (!search.value) { return genres.value.slice(0, 30) }
  return genres.value
    .filter(g => g.name.toLowerCase().includes(search.value.toLowerCase()))
    .slice(0, 30)
})

const close = () => {
  showDropdown.value = false
}

const onDocumentKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    close()
    triggerRef.value?.focus()
  }
}

// document is undefined during SSR - showDropdown always starts false, so there is nothing to
// attach on the very first (server) render. A plain (non-immediate) watch only ever fires on a
// later, client-side change.
watch(showDropdown, (open) => {
  if (open) {
    document.addEventListener('keydown', onDocumentKeydown)
  }
  else {
    document.removeEventListener('keydown', onDocumentKeydown)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div class="relative">
    <!-- Two separate controls sharing one pill, not one <button> nesting another - a clear
         icon inside the trigger button would be unreachable by keyboard and invalid HTML. -->
    <div
      :class="cx(
        'flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors duration-150',
        active ? 'border-amber-400/45 bg-amber-400/10 text-amber-400' : 'border-stone-100/10 bg-stone-900 text-stone-100/60 hover:text-stone-100',
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
        <Tag :size="12" :stroke-width="ICON_STROKE_WIDTH" />
        {{ active || 'Genre' }}
      </button>
      <button v-if="active" type="button" aria-label="Clear genre filter" class="hover:text-stone-100" @click="emit('select', null); close()">
        <X :size="12" :stroke-width="ICON_STROKE_WIDTH" />
      </button>
    </div>

    <div
      v-if="showDropdown"
      role="listbox"
      class="absolute top-full left-0 z-20 mt-1 w-56 rounded-lg border border-stone-100/10 bg-stone-900 p-2 shadow-lg"
    >
      <input
        v-model="search"
        type="text"
        placeholder="Filter genres..."
        class="mb-2 w-full rounded-md border border-stone-100/10 bg-stone-950 px-2 py-1 text-xs text-stone-100 outline-0 placeholder:text-stone-100/30 focus:border-amber-400/45"
      >
      <div class="max-h-48 overflow-y-auto">
        <button
          v-for="genre in filtered"
          :key="genre.id"
          type="button"
          role="option"
          :aria-selected="active === genre.name"
          :class="cx(
            'flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors duration-150 hover:bg-stone-800',
            active === genre.name ? 'text-amber-400' : 'text-stone-100/60',
          )"
          @click="emit('select', genre.name); close()"
        >
          <span>{{ genre.name }}</span>
          <span class="text-stone-100/40">{{ genre.artistCount }}</span>
        </button>
      </div>
    </div>

    <div v-if="showDropdown" class="fixed inset-0 z-10" @click="close" />
  </div>
</template>
