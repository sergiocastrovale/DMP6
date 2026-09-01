<script setup lang="ts">
import { LucideClock, LucideMusic, Loader2 } from 'lucide-vue-next'
import type { Decade, DecadeResponse, TimelineRelease } from '~/types/timeline'
import { grid, ICON_STROKE_WIDTH, sw } from '~/helpers/ui'

useTitle('Timeline')

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

// Clicking through decades/years fires overlapping requests - without a guard, an older request
// that happens to resolve after a newer one silently clobbers decadeData with stale years/releases
// (the decade chip shows the new selection while the list below still shows the old one). A request
// token makes only the most recently issued fetch allowed to write state; the AbortController also
// cancels the superseded request outright instead of leaving it to finish for nothing.
let requestToken = 0
let currentController: AbortController | null = null

async function fetchDecadeData(url: string) {
  currentController?.abort()
  const controller = new AbortController()
  currentController = controller
  const token = ++requestToken
  loadingDecade.value = true
  try {
    const data = await $fetch<DecadeResponse>(url, { signal: controller.signal })
    if (token !== requestToken) {return}
    decadeData.value = data
  }
  catch (error) {
    if (token !== requestToken) {return}
    if ((error as { name?: string })?.name !== 'AbortError') {
      console.error('Failed to load timeline data:', error)
    }
  }
  finally {
    if (token === requestToken) {
      loadingDecade.value = false
    }
  }
}

async function selectDecade(decade: number) {
  selectedDecade.value = decade
  selectedYear.value = null
  await fetchDecadeData(`/api/timeline/${decade}`)
}

async function selectYear(year: number | null) {
  if (!selectedDecade.value) {return}
  selectedYear.value = year
  const url = year
    ? `/api/timeline/${selectedDecade.value}?year=${year}`
    : `/api/timeline/${selectedDecade.value}`
  await fetchDecadeData(url)
}

async function loadMore() {
  if (!decadeData.value || !decadeData.value.hasMore || loadingMore.value) {return}
  loadingMore.value = true
  try {
    const nextPage = decadeData.value.page + 1
    let url = `/api/timeline/${selectedDecade.value}?page=${nextPage}`
    if (selectedYear.value) {url += `&year=${selectedYear.value}`}
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
  if (!decadeData.value) {return []}
  const map = new Map<number, TimelineRelease[]>()
  for (const r of decadeData.value.releases) {
    const year = r.year ?? 0
    if (!map.has(year)) {map.set(year, [])}
    map.get(year)!.push(r)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([year, releases]) => ({ year, releases }))
})

const yearCountMap = computed(() => {
  const map = new Map<number, number>()
  if (decadeData.value) {
    for (const y of decadeData.value.years) {
      map.set(y.year, y.count)
    }
  }
  return map
})

const releaseCountFor = (year: number, fallback: number) => yearCountMap.value.get(year) ?? fallback

onMounted(() => {
  loadDecades()
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <PageTitle text="Timeline" subtext="Browse your library by decade and year" />

    <UiLoadingBlock v-if="loading" />

    <template v-else-if="decades.length > 0">
      <div class="flex flex-wrap gap-2">
        <button
          v-for="d in decades"
          :key="d.decade"
          type="button"
          :class="sw('chip', selectedDecade === d.decade)"
          @click="selectDecade(d.decade)"
        >
          {{ d.decade }}s
          <span class="opacity-70">({{ d.count }})</span>
        </button>
      </div>

      <div v-if="decadeData && decadeData.years.length > 1" class="flex flex-wrap gap-1.5">
        <button
          type="button"
          :class="sw('chip', selectedYear === null)"
          @click="selectYear(null)"
        >
          All
        </button>
        <button
          v-for="y in decadeData.years"
          :key="y.year"
          type="button"
          :class="sw('chip', selectedYear === y.year)"
          @click="selectYear(y.year)"
        >
          {{ y.year }}
          <span class="opacity-70">({{ y.count }})</span>
        </button>
      </div>

      <UiLoadingBlock v-if="loadingDecade" />

      <div v-else-if="decadeData" class="mt-6 flex flex-col gap-10 lg:gap-0 lg:relative lg:pl-[11rem]">
        <div class="hidden lg:block absolute left-28 top-1 bottom-0 w-px bg-stone-800" />

        <div v-for="group in releasesByYear" :key="group.year" class="flex flex-col gap-3 lg:relative lg:gap-0 lg:pb-12">
          <div class="flex items-baseline gap-2 lg:hidden">
            <h3 class="font-display text-xl font-bold text-stone-100 tabular-nums">{{ group.year || '????' }}</h3>
            <span class="text-sm text-stone-100/55">
              {{ releaseCountFor(group.year, group.releases.length) }} {{ releaseCountFor(group.year, group.releases.length) === 1 ? 'release' : 'releases' }}
            </span>
          </div>

          <div class="hidden lg:block absolute -left-[11rem] top-0 w-28 pr-4 text-right">
            <div class="font-display text-3xl font-bold text-stone-100 leading-none tabular-nums">{{ group.year || '????' }}</div>
            <div class="mt-1 text-xs font-medium text-stone-100/55">
              {{ releaseCountFor(group.year, group.releases.length) }} {{ releaseCountFor(group.year, group.releases.length) === 1 ? 'release' : 'releases' }}
            </div>
          </div>

          <div class="hidden lg:block absolute -left-[4.4375rem] top-1.5 size-3.5 rounded-full bg-amber-400 ring-[3px] ring-amber-400/30" />

          <div :class="grid.auto">
            <Block
              v-for="release in group.releases"
              :id="release.id"
              :key="release.id"
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

        <div v-if="decadeData.hasMore" class="flex items-center justify-center gap-2 py-4">
          <InfiniteScroll margin="200px" @load="loadMore" />
          <Loader2 v-if="loadingMore" :size="18" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-stone-100/55" />
        </div>

        <UiEmptyState
          v-if="decadeData.releases.length === 0"
          :icon="LucideMusic"
          message="No releases in this period"
        />

        <div v-if="decadeData.total > 0" class="text-center text-xs text-stone-100/50">
          {{ decadeData.total }} {{ decadeData.total === 1 ? 'release' : 'releases' }}
        </div>
      </div>
    </template>

    <UiEmptyState v-else message="No releases with year information found" />
  </div>
</template>
