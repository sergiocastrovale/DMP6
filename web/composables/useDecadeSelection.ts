import type { DecadeStats } from '~/types/labs'
import { SERIES_DOTS, defaultSelection } from '~/helpers/decadeRadar'

// Which decades are picked on Labs -> Decade DNA. The first load selects the three biggest; the breakdown rows and the
// legend key off the selection's order, so a decade's dot is the colour of its line.
export const useDecadeSelection = (decades: Ref<DecadeStats[] | null | undefined>) => {
  const selectedDecades = ref<string[]>([])

  const selectDefaults = (val: DecadeStats[] | null | undefined) => {
    if (val && val.length > 0) {
      selectedDecades.value = defaultSelection(val)
    }
  }

  watch(decades, selectDefaults)
  // On a full page load the data arrives with the server-rendered payload, so it is already there and the watch never
  // fires; selecting after mount (not during setup) keeps the server and client markup identical.
  onMounted(() => selectDefaults(decades.value))

  const availableDecades = computed(() => decades.value?.map(d => d.decade) || [])

  const selectedSeries = computed(() =>
    (decades.value ?? [])
      .filter(d => selectedDecades.value.includes(d.decade))
      .map((decade, i) => ({ decade, dot: SERIES_DOTS[i % SERIES_DOTS.length]! })),
  )

  const toggleDecade = (decade: string) => {
    const idx = selectedDecades.value.indexOf(decade)
    if (idx >= 0) {
      selectedDecades.value.splice(idx, 1)
    }
    else {
      selectedDecades.value.push(decade)
    }
  }

  return { selectedDecades, availableDecades, selectedSeries, toggleDecade }
}
