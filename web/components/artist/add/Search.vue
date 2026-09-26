<script setup lang="ts">
import { apiErrorMessage } from '~/helpers/apiError'
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
const rateLimited = ref(false)
const monitor = ref(false)
const addingMbid = ref<string | null>(null)

const errorOpen = ref(false)
const errorMessage = ref('')
const errorSlug = ref<string | null>(null)

const search = async () => {
  const q = query.value.trim()
  if (!q || loading.value) {return}
  loading.value = true
  searched.value = true
  rateLimited.value = false
  try {
    const data = await $fetch<{ items: MbArtistSearchRow[] }>('/api/artists/mb-search', { query: { q } })
    results.value = data.items
  }
  catch (e) {
    const message = apiErrorMessage(e, '')
    if (message.includes('503')) {
      rateLimited.value = true
    }
    else {
      toast.error(message || 'MusicBrainz search failed')
    }
    results.value = []
  }
  finally {
    loading.value = false
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
  catch (e) {
    const failure = e as { statusCode?: number, response?: { status?: number } }
    if (failure.statusCode !== 404 && failure.response?.status !== 404) {
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
    <div class="flex flex-col gap-3">
      <SearchInput
        v-model="query"
        placeholder="Artist name or MusicBrainz ID..."
        size="lg"
        :debounce="0"
        wrapper-class="w-full"
        :disabled="loading"
        @submit="search"
      />
      <Switch
        v-if="canMonitor"
        v-model="monitor"
        label="Monitor after adding. Missing releases will be downloaded automatically."
      />
    </div>

    <UiLoadingBlock v-if="loading" />

    <ArtistAddRateLimit v-else-if="rateLimited" @retry="search" />

    <UiEmptyState v-else-if="searched && results.length === 0" message="No artists found on MusicBrainz" />

    <ArtistAddResultsTable
      v-else-if="results.length > 0"
      :items="results"
      :adding-mbid="addingMbid"
      @add="add"
    />

    <ArtistAddErrorDialog v-model="errorOpen" :message="errorMessage" :slug="errorSlug" />
  </div>
</template>
