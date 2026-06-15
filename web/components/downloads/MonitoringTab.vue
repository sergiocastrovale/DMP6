<script setup lang="ts">
import { Loader2, Radar } from 'lucide-vue-next'

interface ArtistRow {
  id: string
  name: string
  slug: string
  monitored: boolean
}

const search = ref('')
const page = ref(1)
const items = ref<ArtistRow[]>([])
const total = ref(0)
const monitoredCount = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const busyIds = ref(new Set<string>())

let searchTimer: ReturnType<typeof setTimeout> | null = null
const onSearch = (val: string) => {
  if (searchTimer) { clearTimeout(searchTimer) }
  searchTimer = setTimeout(() => {
    search.value = val
    page.value = 1
    items.value = []
    fetchItems()
  }, 300)
}

const fetchItems = async (append = false) => {
  append ? (loadingMore.value = true) : (loading.value = true)
  try {
    const data = await $fetch<{ items: ArtistRow[]; total: number; monitoredCount: number; hasMore: boolean }>('/api/artists/monitoring', {
      query: { page: page.value, search: search.value || undefined },
    })
    items.value = append ? [...items.value, ...data.items] : data.items
    total.value = data.total
    monitoredCount.value = data.monitoredCount
    hasMore.value = data.hasMore
  }
  catch { /* ignore */ }
  finally {
    loading.value = false
    loadingMore.value = false
  }
}

const loadMore = () => {
  if (!loadingMore.value && hasMore.value) {
    page.value++
    fetchItems(true)
  }
}

const toggleMonitor = async (artist: ArtistRow) => {
  busyIds.value.add(artist.id)
  try {
    await $fetch(`/api/artists/${artist.slug}`, { method: 'PATCH', body: { monitored: !artist.monitored } })
    const idx = items.value.findIndex(a => a.id === artist.id)
    if (idx !== -1) {
      items.value[idx]!.monitored = !artist.monitored
    }
    monitoredCount.value += artist.monitored ? -1 : 1
  }
  catch { /* ignore */ }
  finally {
    busyIds.value.delete(artist.id)
    busyIds.value = new Set(busyIds.value)
  }
}

onMounted(() => fetchItems())
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between gap-3">
      <SearchInput
        model-value=""
        placeholder="Search artists..."
        :debounce="0"
        wrapper-class="sm:max-w-xs"
        @update:model-value="onSearch"
      />
      <span class="shrink-0 text-sm text-ink-3">
        {{ monitoredCount.toLocaleString() }} / {{ total.toLocaleString() }} monitored
      </span>
    </div>

    <div v-if="loading" class="flex justify-center py-16">
      <Loader2 :size="22" class="animate-spin text-ink-3" />
    </div>

    <div v-else-if="items.length === 0" class="py-16 text-center text-sm text-ink-3">
      No artists found
    </div>

    <div v-else class="overflow-x-auto rounded-lg border border-rule">
      <table class="w-full">
        <thead>
          <tr class="border-b border-rule bg-bg-1">
            <th class="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-ink-3">Artist</th>
            <th class="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-ink-3">Status</th>
            <th class="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wider text-ink-3">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="artist in items"
            :key="artist.id"
            class="border-b border-rule/50 last:border-b-0 transition-colors hover:bg-bg-1"
          >
            <td class="px-4 py-2.5">
              <NuxtLink :to="`/artist/${artist.slug}`" class="text-sm text-ink transition-colors hover:text-accent">
                {{ artist.name }}
              </NuxtLink>
            </td>
            <td class="px-4 py-2.5 text-right">
              <span
                class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                :class="artist.monitored ? 'bg-accent/15 text-accent' : 'bg-bg-2 text-ink-3'"
              >
                <Radar v-if="artist.monitored" :size="11" />
                {{ artist.monitored ? 'Monitored' : 'Not monitored' }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-right">
              <UiButton
                size="sm"
                :variant="artist.monitored ? 'secondary' : 'primary'"
                :loading="busyIds.has(artist.id)"
                @click="toggleMonitor(artist)"
              >
                {{ artist.monitored ? 'Turn off' : 'Turn on' }}
              </UiButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <InfiniteScroll @load="loadMore" />

    <div v-if="loadingMore" class="flex justify-center py-6">
      <Loader2 :size="20" class="animate-spin text-ink-3" />
    </div>
  </div>
</template>
