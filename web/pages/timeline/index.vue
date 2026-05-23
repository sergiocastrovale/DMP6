<script setup lang="ts">
import { LucideClock, LucideMusic } from 'lucide-vue-next'

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

async function loadDecades() {
  loading.value = true
  try {
    decades.value = await $fetch<Decade[]>('/api/timeline/decades')
    if (decades.value.length > 0) {
      await selectDecade(decades.value[0]!.decade)
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
    <PageTitle :icon="LucideClock" text="Timeline" subtext="Browse your library by decade and year" />

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <div class="text-ink0">Loading...</div>
    </div>

    <template v-else-if="decades.length > 0">
      <!-- Decade tabs -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="d in decades"
          :key="d.decade"
          class="rounded-lg px-4 py-2 text-sm font-medium transition-colors"
          :class="selectedDecade === d.decade
            ? 'bg-accent text-accent-ink'
            : 'bg-bg-2 text-ink-2 hover:text-ink'"
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
            ? 'bg-accent text-accent-ink'
            : 'bg-bg-2 text-ink-2 hover:text-ink'"
          @click="selectYear(null)"
        >
          All
        </button>
        <button
          v-for="y in decadeData.years"
          :key="y.year"
          class="rounded px-3 py-1 text-xs font-medium transition-colors"
          :class="selectedYear === y.year
            ? 'bg-accent text-accent-ink'
            : 'bg-bg-2 text-ink-2 hover:text-ink'"
          @click="selectYear(y.year)"
        >
          {{ y.year }}
          <span class="ml-0.5 opacity-70">({{ y.count }})</span>
        </button>
      </div>

      <!-- Loading decade -->
      <div v-if="loadingDecade" class="flex items-center justify-center py-16">
        <div class="text-ink0">Loading...</div>
      </div>

      <!-- Releases grouped by year -->
      <div v-else-if="decadeData" class="flex flex-col gap-10">
        <div v-for="group in releasesByYear" :key="group.year">
          <h2 class="mb-4 text-lg font-semibold text-ink-2">
            {{ group.year || 'Unknown Year' }}
          </h2>
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            <Block
              v-for="release in group.releases"
              :key="release.id"
              :id="release.id"
              :title="release.title"
              :title-link="`/artist/${release.artist!.slug}?releaseId=${release.id}`"
              :subtitle="release.artist!.name"
              :subtitle-link="`/artist/${release.artist!.slug}`"
              :image="releaseImage(release)"
              playable
              :release-id="release.id"
              :artist-slug="release.artist!.slug"
            />
          </div>
        </div>

        <!-- Load more -->
        <div v-if="decadeData.hasMore" class="flex justify-center py-4">
          <button
            class="rounded-lg bg-bg-2 px-6 py-2 text-sm text-ink-2 hover:bg-bg-3 transition-colors"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? 'Loading...' : 'Load more' }}
          </button>
        </div>

        <!-- Empty state -->
        <div
          v-if="decadeData.releases.length === 0"
          class="flex flex-col items-center justify-center py-20 text-center text-ink0"
        >
          <LucideMusic class="mb-3 size-12 opacity-50" />
          <p>No releases in this period</p>
        </div>

        <!-- Total count -->
        <div v-if="decadeData.total > 0" class="text-center text-xs text-ink-4">
          {{ decadeData.total }} {{ decadeData.total === 1 ? 'release' : 'releases' }}
        </div>
      </div>
    </template>

    <!-- No data -->
    <div v-else class="flex flex-col items-center justify-center py-20 text-center text-ink0">
      <LucideClock class="mb-3 size-12 opacity-50" />
      <p>No releases with year information found</p>
    </div>
  </div>
</template>
