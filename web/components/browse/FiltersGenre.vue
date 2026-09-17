<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import { useBrowseStore } from '~/stores/browse'
import { isAbortError } from '~/helpers/functions'
import { ICON_STROKE_WIDTH, form } from '~/helpers/ui'

interface GenreResult {
  id: string
  name: string
  artistCount: number
}

const store = useBrowseStore()

const search = ref('')
const results = ref<GenreResult[]>([])
// Distinct from `loading` (data in flight but nothing to show yet) so a fresh keystroke shows a
// spinner next to the still-visible previous results rather than blanking the list.
const loading = ref(false)
const loaded = ref(false)

let abortController: AbortController | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const fetchGenres = async () => {
  abortController?.abort()
  const controller = new AbortController()
  abortController = controller
  loading.value = true

  try {
    const data = await $fetch<GenreResult[]>('/api/genres', {
      params: { search: search.value || undefined, limit: 5 },
      signal: controller.signal,
    })
    if (controller.signal.aborted) { return } // superseded by a newer request - ignore this response
    results.value = data
    loaded.value = true
  }
  catch (e) {
    if (!isAbortError(e)) { throw e }
  }
  finally {
    if (abortController === controller) {
      loading.value = false
    }
  }
}

watch(search, () => {
  if (debounceTimer) { clearTimeout(debounceTimer) }
  debounceTimer = setTimeout(fetchGenres, 250)
})

onMounted(fetchGenres)

onUnmounted(() => {
  if (debounceTimer) { clearTimeout(debounceTimer) }
  abortController?.abort()
})

// Checked genres that fell out of the current top-5/search results are pinned above them, so a
// genre can always be unticked even after narrowing the search past it.
const pinned = computed(() => store.genreFilters.filter(g => !results.value.some(r => r.name === g)))
</script>

<template>
  <div class="flex flex-col gap-2">
    <div :class="form.search">
      <Search :size="14" :stroke-width="ICON_STROKE_WIDTH" class="shrink-0 text-stone-100/55" />
      <input
        v-model="search"
        type="text"
        placeholder="Filter genres..."
        :class="form.searchInput"
      >
      <UiSpinner v-if="loading" :size="14" />
    </div>

    <div class="flex flex-col gap-2" :aria-busy="loading">
      <template v-if="!loaded">
        <UiSkeleton v-for="n in 5" :key="n" h="h-7" />
      </template>
      <template v-else>
        <UiCheckbox
          v-for="genre in pinned"
          :key="genre"
          :model-value="true"
          :label="genre"
          @update:model-value="store.toggleGenre(genre)"
        />
        <UiCheckbox
          v-for="genre in results"
          :key="genre.id"
          :model-value="store.genreFilters.includes(genre.name)"
          @update:model-value="store.toggleGenre(genre.name)"
        >
          <span class="flex w-full items-center justify-between gap-2">
            <span class="text-base text-stone-100/90">{{ genre.name }}</span>
            <span class="text-stone-100/55 text-sm">{{ genre.artistCount }} artists</span>
          </span>
        </UiCheckbox>
        <p v-if="!pinned.length && !results.length" class="py-1 text-sm text-stone-100/55">
          No genres match
        </p>
      </template>
    </div>
  </div>
</template>
