<script setup lang="ts">
import { Search as SearchIcon } from 'lucide-vue-next'
import type { MbArtistSearchRow } from '~/types/artist'
import { useTerminalStore } from '~/stores/terminal'
import { useToastStore } from '~/stores/toast'
import { scanSessionName } from '~/helpers/functions'

const { hasPerm } = useAuth()
const canMonitor = hasPerm('downloads.crud')

const terminal = useTerminalStore()
const toast = useToastStore()
// Captured at setup: navigateTo() after an `await` past this component's lifetime needs a Nuxt
// instance restored - see components/artist/DeleteDialog.vue for the same pattern.
const nuxtApp = useNuxtApp()

const query = ref('')
const results = ref<MbArtistSearchRow[]>([])
const searched = ref(false)
const loading = ref(false)
const counts = ref<Record<string, number | 'error' | undefined>>({})
const monitor = ref(false)
const addingMbid = ref<string | null>(null)

const errorOpen = ref(false)
const errorMessage = ref('')
const errorSlug = ref<string | null>(null)

// Abandons an in-flight counts loop when a new search starts or the component unmounts - counts are
// keyed by mbid so a stale write would just be wrong data landing on the right row.
let countsGeneration = 0

const search = async () => {
  const q = query.value.trim()
  if (!q) {return}
  loading.value = true
  searched.value = true
  const gen = ++countsGeneration
  counts.value = {}
  try {
    const data = await $fetch<{ items: MbArtistSearchRow[] }>('/api/artists/mb-search', { query: { q } })
    if (gen !== countsGeneration) {return}
    results.value = data.items
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'MusicBrainz search failed')
    results.value = []
  }
  finally {
    loading.value = false
  }
  loadCounts(gen)
}

const loadCounts = async (gen: number) => {
  for (const row of results.value) {
    if (gen !== countsGeneration) {return}
    try {
      const { count } = await $fetch<{ count: number }>(`/api/artists/mb-official-count/${row.mbid}`)
      if (gen !== countsGeneration) {return}
      counts.value = { ...counts.value, [row.mbid]: count }
    }
    catch {
      if (gen !== countsGeneration) {return}
      counts.value = { ...counts.value, [row.mbid]: 'error' }
    }
  }
}

const showAlreadyExists = (name: string, slug: string | null) => {
  errorMessage.value = `"${name}" is already in your library`
  errorSlug.value = slug
  errorOpen.value = true
}

const add = async (row: MbArtistSearchRow) => {
  // Fresh check - another tab/user may have added this artist since the page loaded, so the
  // `existing` field on the search result can be stale.
  try {
    const existing = await $fetch<{ slug: string, name: string }>(`/api/artists/by-mbid/${row.mbid}`)
    showAlreadyExists(existing.name, existing.slug)
    return
  }
  catch (e: any) {
    if (e?.statusCode !== 404 && e?.response?.status !== 404) {
      toast.error('Could not check the library - try again')
      return
    }
  }

  addingMbid.value = row.mbid
  const args = ['--mbid', row.mbid, ...(monitor.value ? ['--monitored'] : [])]
  await terminal.run('./add', args, scanSessionName('add', row.name))

  if (terminal.exitCode === 0) {
    try {
      const added = await $fetch<{ slug: string }>(`/api/artists/added/${row.mbid}`, { method: 'POST' })
      await nuxtApp.runWithContext(() => navigateTo(`/artist/${added.slug}`))
      return
    }
    catch {
      toast.error(`Added ${row.name}, but couldn't open its page - find it in Browse`)
    }
  }
  else if (terminal.exitCode === 3) {
    let slug: string | null = null
    try {
      slug = (await $fetch<{ slug: string }>(`/api/artists/by-mbid/${row.mbid}`)).slug
    }
    catch { /* keep null */ }
    showAlreadyExists(row.name, slug)
  }
  else {
    toast.error(`Adding ${row.name} failed - see terminal`)
  }
  addingMbid.value = null
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <SearchInput
        v-model="query"
        placeholder="Artist name..."
        :debounce="0"
        wrapper-class="sm:max-w-sm"
        @submit="search"
      />
      <UiButton variant="secondary" :icon="SearchIcon" :loading="loading" @click="search">
        Search in MusicBrainz
      </UiButton>
      <Switch v-if="canMonitor" v-model="monitor" label="Monitor after adding" />
    </div>

    <UiLoadingBlock v-if="loading" />

    <UiEmptyState v-else-if="searched && results.length === 0" message="No artists found on MusicBrainz" />

    <ArtistAddResultsTable
      v-else-if="results.length > 0"
      :items="results"
      :counts="counts"
      :adding-mbid="addingMbid"
      @add="add"
    />

    <ArtistAddErrorDialog v-model="errorOpen" :message="errorMessage" :slug="errorSlug" />
  </div>
</template>
