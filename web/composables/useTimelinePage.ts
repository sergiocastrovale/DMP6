import type { Decade, DecadeResponse, TimelineRelease, TimelineYearGroup } from '~/types/timeline'

// State behind pages/timeline/index.vue: the decades, the selected decade/year, the releases loaded for them (paged,
// and superseding a slower earlier request) and their grouping by year.
export const useTimelinePage = () => {
  const loading = ref(true)
  const decades = ref<Decade[]>([])
  const selectedDecade = ref<number | null>(null)
  const selectedYear = ref<number | null>(null)
  const decadeData = ref<DecadeResponse | null>(null)
  const loadingDecade = ref(false)
  const loadingMore = ref(false)

  const api = useApi()

  const loadDecades = async () => {
    loading.value = true
    try {
      decades.value = await $fetch<Decade[]>('/api/timeline/decades')
      if (decades.value.length > 0) {
        await selectDecade(decades.value[0]!.decade)
      }
    }
    catch (e) {
      api.report(e, 'Could not load the timeline')
    }
    finally {
      loading.value = false
    }
  }

  let requestToken = 0
  let currentController: AbortController | null = null

  const fetchDecadeData = async (url: string) => {
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
      api.report(error, 'Could not load that decade')
    }
    finally {
      if (token === requestToken) {
        loadingDecade.value = false
      }
    }
  }

  const selectDecade = async (decade: number) => {
    selectedDecade.value = decade
    selectedYear.value = null
    await fetchDecadeData(`/api/timeline/${decade}`)
  }

  const selectYear = async (year: number | null) => {
    if (!selectedDecade.value) {return}
    selectedYear.value = year
    const url = year
      ? `/api/timeline/${selectedDecade.value}?year=${year}`
      : `/api/timeline/${selectedDecade.value}`
    await fetchDecadeData(url)
  }

  const loadMore = async () => {
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
    catch (e) {
      api.report(e, 'Could not load more releases')
    }
    finally {
      loadingMore.value = false
    }
  }

  // Releases grouped by year, each with the year's full release count (the page holds only what has loaded so far).
  const releasesByYear = computed<TimelineYearGroup[]>(() => {
    if (!decadeData.value) {return []}
    const counts = new Map(decadeData.value.years.map(y => [y.year, y.count]))
    const map = new Map<number, TimelineRelease[]>()
    for (const r of decadeData.value.releases) {
      const year = r.year ?? 0
      if (!map.has(year)) {map.set(year, [])}
      map.get(year)!.push(r)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a - b)
      .map(([year, releases]) => ({ year, releases, count: counts.get(year) ?? releases.length }))
  })

  onMounted(loadDecades)

  return {
    loading, decades, selectedDecade, selectedYear, decadeData, loadingDecade, loadingMore,
    releasesByYear, selectDecade, selectYear, loadMore,
  }
}
