<script setup lang="ts">
import { Loader2, Radar, EyeOff, HelpCircle, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-vue-next'
import { type SortDir } from '~/helpers/functions'

interface ArtistRow {
  id: string
  name: string
  slug: string
  monitored: boolean
  missingReleases: number
  totalReleases: number
}

const store = useDownloadsStore()
const toast = useToastStore()

const search = ref('')
const page = ref(1)
const items = ref<ArtistRow[]>([])
const total = ref(0)
const monitoredCount = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const busyIds = ref(new Set<string>())
const showMonitored = ref(true)
const showUnmonitored = ref(true)

const sortKey = ref<'name' | 'missingReleases' | 'totalReleases' | 'monitored'>('name')
const sortDir = ref<SortDir>('asc')

const selected = ref<Set<string>>(new Set())
const bulkBusy = ref(false)
const pendingMonitor = ref<boolean | null>(null)
const confirmOpen = ref(false)

const bulkActions = [
  { key: 'monitor', label: 'Monitor selected', icon: Radar, variant: 'primary' as const },
  { key: 'unmonitor', label: 'Unmonitor selected', icon: EyeOff, variant: 'secondary' as const },
]

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

watch([showMonitored, showUnmonitored, sortKey, sortDir], () => {
  page.value = 1
  items.value = []
  fetchItems()
})

const onSort = (key: string) => {
  if (sortKey.value === key) {
    sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
  }
  else {
    sortKey.value = key as typeof sortKey.value
    sortDir.value = 'asc'
  }
}

const fetchItems = async (append = false) => {
  append ? (loadingMore.value = true) : (loading.value = true)
  try {
    const data = await $fetch<{ items: ArtistRow[]; total: number; monitoredCount: number; hasMore: boolean }>('/api/artists/monitoring', {
      query: {
        page: page.value,
        search: search.value || undefined,
        showMonitored: showMonitored.value,
        showUnmonitored: showUnmonitored.value,
        sort: sortKey.value,
        dir: sortDir.value,
      },
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

const allChecked = computed(() => items.value.length > 0 && items.value.every(a => selected.value.has(a.id)))
const selectedRows = computed(() => items.value.filter(a => selected.value.has(a.id)))

// Already-in-the-target-state rows are filtered out: "Monitor selected" only touches unmonitored rows,
// "Unmonitor selected" only touches monitored ones.
const pendingTargets = computed(() =>
  pendingMonitor.value === null ? [] : selectedRows.value.filter(a => a.monitored !== pendingMonitor.value),
)
const confirmLabel = computed(() => (pendingMonitor.value ? 'Monitor' : 'Unmonitor'))
const confirmMessage = computed(() => {
  const n = pendingTargets.value.length
  const verb = pendingMonitor.value ? 'monitor' : 'unmonitor'
  return `${verb.charAt(0).toUpperCase()}${verb.slice(1)} ${n} artist${n === 1 ? '' : 's'}?`
})

const toggleAll = () => {
  const next = new Set(selected.value)
  allChecked.value ? items.value.forEach(a => next.delete(a.id)) : items.value.forEach(a => next.add(a.id))
  selected.value = next
}
const toggleRow = (id: string) => {
  const next = new Set(selected.value)
  next.has(id) ? next.delete(id) : next.add(id)
  selected.value = next
}

const onBulkAction = (key: string) => {
  pendingMonitor.value = key === 'monitor'
  if (!pendingTargets.value.length) {
    toast.info(`No selected artist to ${pendingMonitor.value ? 'monitor' : 'unmonitor'}`)
    return
  }
  confirmOpen.value = true
}

const confirmBulk = async () => {
  const monitor = pendingMonitor.value
  const ids = pendingTargets.value.map(a => a.id)
  confirmOpen.value = false
  if (monitor === null || !ids.length) {
    return
  }
  bulkBusy.value = true
  try {
    await $fetch('/api/artists/monitor-selected', { method: 'POST', body: { ids, monitored: monitor } })
    items.value.forEach((a) => {
      if (ids.includes(a.id)) {
        a.monitored = monitor
      }
    })
    monitoredCount.value += monitor ? ids.length : -ids.length
    selected.value = new Set()
    toast.success(`${monitor ? 'Monitoring' : 'Unmonitored'} ${ids.length} artist${ids.length === 1 ? '' : 's'}`)
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Bulk monitor failed')
  }
  finally {
    bulkBusy.value = false
  }
}

onMounted(() => {
  fetchItems()
})
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
      <div class="flex items-center gap-4">
        <Switch v-model="showMonitored" label="Show monitored" />
        <Switch v-model="showUnmonitored" label="Show unmonitored" />
        <span class="shrink-0 text-sm text-ink-3">
          {{ monitoredCount.toLocaleString() }} / {{ total.toLocaleString() }} monitored
        </span>
      </div>
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
          <tr class="border-b border-rule bg-bg-1 text-xs font-semibold uppercase tracking-wider text-ink-3">
            <th class="w-10 px-4 py-2 text-left">
              <input type="checkbox" :checked="allChecked" class="rounded border-rule bg-bg-2" title="Select all rows" @change="toggleAll" />
            </th>
            <SortableTh label="Artist" sort-key="name" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
            <SortableTh label="Missing / MB total" sort-key="missingReleases" align="right" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
            <th class="px-4 py-2 text-right font-semibold">
              <div class="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  class="inline-flex flex-row-reverse items-center gap-1 transition-colors hover:text-ink-2"
                  :class="sortKey === 'monitored' ? 'text-ink-2' : ''"
                  title="Sort by monitoring"
                  @click="onSort('monitored')"
                >
                  Monitoring
                  <component
                    :is="sortKey === 'monitored' ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown"
                    :size="12"
                    :class="sortKey === 'monitored' ? 'opacity-100' : 'opacity-40'"
                  />
                </button>
                <Popover trigger="hover">
                  <template #trigger>
                    <HelpCircle :size="13" class="cursor-help text-ink-4" />
                  </template>
                  <template #content>
                    <div class="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-rule bg-bg-1 p-3 text-left shadow-xl">
                      <p class="text-xs font-normal normal-case tracking-normal text-ink-2">
                        Monitoring an artist lets dmp automatically search Soulseek for the releases
                        missing from your library and download them in the background. Approved
                        downloads wait in “Ready to merge” until you merge them in.
                      </p>
                    </div>
                  </template>
                </Popover>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="artist in items"
            :key="artist.id"
            class="border-b border-rule/50 last:border-b-0 transition-colors hover:bg-bg-1"
            :class="selected.has(artist.id) ? 'bg-blue-950/20' : ''"
          >
            <td class="px-4 py-2.5">
              <input
                type="checkbox"
                :checked="selected.has(artist.id)"
                class="rounded border-rule bg-bg-2"
                :title="`Select ${artist.name}`"
                @change="toggleRow(artist.id)"
              />
            </td>
            <td class="px-4 py-2.5">
              <NuxtLink :to="`/artist/${artist.slug}`" class="text-sm text-ink transition-colors hover:text-accent">
                {{ artist.name }}
              </NuxtLink>
            </td>
            <td class="px-4 py-2.5 text-right text-sm tabular-nums">
              <template v-if="artist.totalReleases > 0">
                <span :class="artist.missingReleases > 0 ? 'font-medium text-amber-400' : 'text-ink-3'">{{ artist.missingReleases }}</span>
                <span class="text-ink-4"> / {{ artist.totalReleases }}</span>
              </template>
              <span v-else class="text-ink-4">—</span>
            </td>
            <td class="px-4 py-2.5 text-right">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                :class="artist.monitored
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                  : 'border-rule bg-bg-1 text-ink-2 hover:border-ink-4 hover:bg-bg-2 hover:text-ink'"
                :disabled="busyIds.has(artist.id)"
                :title="artist.monitored ? `Stop monitoring ${artist.name}` : `Monitor ${artist.name}`"
                @click="toggleMonitor(artist)"
              >
                <Loader2 v-if="busyIds.has(artist.id)" :size="13" class="animate-spin" />
                <Radar v-else-if="artist.monitored" :size="13" />
                {{ artist.monitored ? 'ON' : 'OFF' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <InfiniteScroll @load="loadMore" />

    <div v-if="loadingMore" class="flex justify-center py-6">
      <Loader2 :size="20" class="animate-spin text-ink-3" />
    </div>

    <ConfirmDialog
      v-model="confirmOpen"
      title="Update monitoring"
      :message="confirmMessage"
      :confirm-label="confirmLabel"
      :icon="pendingMonitor ? Radar : EyeOff"
      @confirm="confirmBulk"
    />
    <DownloadsSelectionBar
      :count="selected.size"
      :loading="bulkBusy"
      :actions="bulkActions"
      @action="onBulkAction"
    />
  </div>
</template>
