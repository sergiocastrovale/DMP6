<script setup lang="ts">
import { Tag, X } from 'lucide-vue-next'

const props = defineProps<{
  active: string | null
}>()

const emit = defineEmits<{
  select: [genre: string | null]
}>()

const { data: genres } = useFetch<{ id: string; name: string; artistCount: number }[]>('/api/genres')
const showDropdown = ref(false)
const search = ref('')

const filtered = computed(() => {
  if (!genres.value) return []
  if (!search.value) return genres.value.slice(0, 30)
  return genres.value
    .filter(g => g.name.toLowerCase().includes(search.value.toLowerCase()))
    .slice(0, 30)
})
</script>

<template>
  <div class="relative">
    <button
      class="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
      :class="
        active
          ? 'border-amber-500 bg-amber-500/10 text-amber-400'
          : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-50'
      "
      @click="showDropdown = !showDropdown"
    >
      <Tag :size="12" />
      {{ active || 'Genre' }}
      <X v-if="active" :size="12" class="ml-1" @click.stop="emit('select', null); showDropdown = false" />
    </button>

    <div
      v-if="showDropdown"
      class="absolute top-full left-0 z-20 mt-1 w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-lg"
    >
      <input
        v-model="search"
        type="text"
        placeholder="Filter genres..."
        class="mb-2 w-full rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-50 placeholder:text-zinc-500 focus:border-amber-500 focus:outline-none"
      />
      <div class="max-h-48 overflow-y-auto">
        <button
          v-for="genre in filtered"
          :key="genre.id"
          class="flex w-full items-center justify-between rounded px-2 py-1 text-left text-xs transition-colors hover:bg-zinc-800"
          :class="active === genre.name ? 'text-amber-400' : 'text-zinc-300'"
          @click="emit('select', genre.name); showDropdown = false"
        >
          <span>{{ genre.name }}</span>
          <span class="text-zinc-500">{{ genre.artistCount }}</span>
        </button>
      </div>
    </div>
  </div>
</template>
