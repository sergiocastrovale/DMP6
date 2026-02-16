<script setup lang="ts">
import { LucideClock, LucidePlay, LucideMusic } from 'lucide-vue-next'

interface Decade {
  decade: number
  count: number
}

interface YearCount {
  year: number
  count: number
}

interface TimelineRelease {
  id: string
  title: string
  releaseType: string | null
  year: number | null
  image: string | null
  imageUrl: string | null
  artist: { id: string; name: string; slug: string } | null
}

interface DecadeResponse {
  releases: TimelineRelease[]
  total: number
  page: number
  hasMore: boolean
  years: YearCount[]
}

const loading = ref(true)
const decades = ref<Decade[]>([])
const selectedDecade = ref<number | null>(null)
const selectedYear = ref<number | null>(null)
const decadeData = ref<DecadeResponse | null>(null)
const loadingDecade = ref(false)
const loadingMore = ref(false)

const { releaseImage } = useImageUrl()
const playerStore = usePlayerStore()

async function loadDecades() {
  loading.value = true
  try {
    decades.value = await $fetch<Decade[]>('/api/timeline/decades')
    if (decades.value.length > 0) {
      await selectDecade(decades.value[0].decade)
    }
  }
  catch (error) {
    console.error('Failed to load decades:', error)
  }
  finally {
    loading.value = false
  }
}

async function selectDecade(decade: number) {
  selectedDecade.value = decade
  selectedYear.value = null
  loadingDecade.value = true
  try {
    decadeData.value = await $fetch<DecadeResponse>(`/api/timeline/${decade}`)
  }
  catch (error) {
    console.error('Failed to load decade:', error)
  }
  finally {
    loadingDecade.value = false
  }
}

async function selectYear(year: number | null) {
  if (!selectedDecade.value) return
  selectedYear.value = year
  loadingDecade.value = true
  try {
    const url = year
      ? `/api/timeline/${selectedDecade.value}?year=${year}`
      : `/api/timeline/${selectedDecade.value}`
    decadeData.value = await $fetch<DecadeResponse>(url)
  }
  catch (error) {
    console.error('Failed to load year:', error)
  }
  finally {
    loadingDecade.value = false
  }
}

async function loadMore() {
  if (!decadeData.value || !decadeData.value.hasMore || loadingMore.value) return
  loadingMore.value = true
  try {
    const nextPage = decadeData.value.page + 1
    let url = `/api/timeline/${selectedDecade.value}?page=${nextPage}`
    if (selectedYear.value) url += `&year=${selectedYear.value}`
    const more = await $fetch<DecadeResponse>(url)
    decadeData.value.releases.push(...more.releases)
    decadeData.value.page = more.page
    decadeData.value.hasMore = more.hasMore
  }
  catch (error) {
    console.error('Failed to load more:', error)
  }
  finally {
    loadingMore.value = false
  }
}

async function playRelease(releaseId: string) {
  try {
    const tracks = await $fetch<any[]>(`/api/releases/${releaseId}/tracks`)
    if (tracks && tracks.length > 0) {
      playerStore.playTrack(tracks[0], tracks)
    }
  }
  catch (error) {
    console.error('Failed to load release tracks:', error)
  }
}

// Group releases by year for display
const releasesByYear = computed(() => {
  if (!decadeData.value) return []
  const map = new Map<number, TimelineRelease[]>()
  for (const r of decadeData.value.releases) {
    const year = r.year ?? 0
    if (!map.has(year)) map.set(year, [])
    map.get(year)!.push(r)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, releases]) => ({ year, releases }))
})

onMounted(() => {
  loadDecades()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold text-zinc-50">
        <LucideClock class="inline size-6 -mt-1 text-amber-500" />
        Timeline
      </h1>
      <p class="mt-1 text-sm text-zinc-500">
        Browse your library by decade and year
      </p>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-zinc-500">Loading...</div>
    </div>

    <template v-else-if="decades.length > 0">
      <!-- Decade tabs -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="d in decades"
          :key="d.decade"
          class="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          :class="selectedDecade === d.decade
            ? 'bg-amber-500 text-zinc-950'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-50'"
          @click="selectDecade(d.decade)"
        >
          {{ d.decade }}s
          <span class="ml-1 text-xs opacity-70">({{ d.count }})</span>
        </button>
      </div>

      <!-- Year sub-navigation -->
      <div v-if="decadeData && decadeData.years.length > 1" class="flex flex-wrap gap-1">
        <button
          class="rounded px-3 py-1 text-xs font-medium transition-colors"
          :class="!selectedYear
            ? 'bg-amber-500 text-zinc-950'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-50'"
          @click="selectYear(null)"
        >
          All
        </button>
        <button
          v-for="y in decadeData.years"
          :key="y.year"
          class="rounded px-3 py-1 text-xs font-medium transition-colors"
          :class="selectedYear === y.year
            ? 'bg-amber-500 text-zinc-950'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-50'"
          @click="selectYear(y.year)"
        >
          {{ y.year }}
          <span class="ml-0.5 opacity-70">({{ y.count }})</span>
        </button>
      </div>

      <!-- Loading decade -->
      <div v-if="loadingDecade" class="flex items-center justify-center py-16">
        <div class="text-zinc-500">Loading...</div>
      </div>

      <!-- Releases grouped by year -->
      <div v-else-if="decadeData" class="flex flex-col gap-10">
        <div v-for="group in releasesByYear" :key="group.year">
          <h2 class="mb-4 text-lg font-semibold text-zinc-300">
            {{ group.year || 'Unknown Year' }}
          </h2>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            <div
              v-for="release in group.releases"
              :key="release.id"
              class="group flex flex-col gap-2"
            >
              <div class="relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
                <img
                  v-if="releaseImage(release)"
                  :src="releaseImage(release)!"
                  :alt="release.title"
                  loading="lazy"
                  class="h-full w-full object-cover transition-transform group-hover:scale-105"
                >
                <div v-else class="flex h-full w-full items-center justify-center text-zinc-600">
                  <LucideMusic class="size-12" />
                </div>
                <button
                  class="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100"
                  @click="playRelease(release.id)"
                >
                  <div class="rounded-full bg-amber-500 p-3 text-zinc-950 shadow-lg">
                    <LucidePlay class="size-6" fill="currentColor" />
                  </div>
                </button>
              </div>
              <div class="flex flex-col gap-0.5">
                <NuxtLink
                  v-if="release.artist"
                  :to="`/artist/${release.artist.slug}`"
                  class="line-clamp-1 text-sm font-medium text-zinc-50 hover:text-amber-500 transition-colors"
                >
                  {{ release.title }}
                </NuxtLink>
                <p v-else class="line-clamp-1 text-sm font-medium text-zinc-50">{{ release.title }}</p>
                <NuxtLink
                  v-if="release.artist"
                  :to="`/artist/${release.artist.slug}`"
                  class="line-clamp-1 text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
                >
                  {{ release.artist.name }}
                </NuxtLink>
              </div>
            </div>
          </div>
        </div>

        <!-- Load more -->
        <div v-if="decadeData.hasMore" class="flex justify-center py-4">
          <button
            class="rounded-lg bg-zinc-800 px-6 py-2 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? 'Loading...' : 'Load more' }}
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-if="decadeData.releases.length === 0"
          class="flex flex-col items-center justify-center py-20 text-center text-zinc-500"
        >
          <LucideMusic class="mb-3 size-12 opacity-50" />
          <p>No releases in this period</p>
        </div>

        <!-- Total count -->
        <div v-if="decadeData.total > 0" class="text-center text-xs text-zinc-600">
          {{ decadeData.total }} {{ decadeData.total === 1 ? 'release' : 'releases' }}
        </div>
      </div>
    </template>

    <!-- No data -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-center text-zinc-500">
      <LucideClock class="mb-3 size-12 opacity-50" />
      <p>No releases with year information found</p>
    </div>
  </div>
</template>
