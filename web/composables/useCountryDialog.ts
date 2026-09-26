import type { MapCountry } from '~/types/labs'

export interface CountryArtist { id: string, name: string, slug: string, image: string | null, imageUrl: string | null }

interface ArtistsPage { items: CountryArtist[], hasMore: boolean }

// The artists dialog behind a click on a country: opens on a country with artists, pages in 50 at a time.
export const useCountryDialog = (countries: Ref<Record<string, MapCountry> | null | undefined>) => {
  const open = ref(false)
  const country = ref<{ code: string, name: string, count: number } | null>(null)
  const artists = ref<CountryArtist[]>([])
  const page = ref(1)
  const hasMore = ref(false)
  const loading = ref(false)

  const fetchPage = async (code: string, nextPage: number) => {
    loading.value = true
    try {
      const data = await $fetch<ArtistsPage>('/api/labs/map/artists', {
        query: { country: code, page: nextPage, pageSize: 50 },
      })
      artists.value = nextPage === 1 ? data.items : [...artists.value, ...data.items]
      hasMore.value = data.hasMore
      page.value = nextPage
    }
    finally {
      loading.value = false
    }
  }

  const openCountry = (code: string) => {
    const entry = countries.value?.[code]
    if (!entry || entry.count === 0) {
      return
    }
    country.value = { code, name: entry.name, count: entry.count }
    artists.value = []
    page.value = 1
    hasMore.value = false
    open.value = true
    fetchPage(code, 1)
  }

  const loadMore = () => {
    if (!loading.value && hasMore.value && country.value) {
      fetchPage(country.value.code, page.value + 1)
    }
  }

  return { open, country, artists, hasMore, loading, openCountry, loadMore }
}
