<script setup lang="ts">
import { Loader2, Radar, EyeOff, CircleHelp, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-vue-next'
import type { SortDirection } from '~/types/common'
import type { MonitoringArtistRow as ArtistRow } from '~/types/artist'
import { sw, surface, cx, ICON_STROKE_WIDTH, data } from '~/helpers/ui'
import { toggleRowSelection } from '~/helpers/functions'

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
const sortDir = ref<SortDirection>('asc')

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
const anchorId = ref<string | null>(null)
let pendingShiftKey = false

const captureRowClick = (event: MouseEvent) => {
  pendingShiftKey = event.shiftKey
}

const toggleRow = (id: string) => {
  const ids = items.value.map(a => a.id)
  selected.value = toggleRowSelection(ids, selected.value, id, { shiftKey: pendingShiftKey }, anchorId.value)
  anchorId.value = id
  pendingShiftKey = false
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
  <div class="flex flex-col gap-4">
    <DownloadsTabHint>
      Monitored artists are checked for missing releases on a recurring schedule and queued
      automatically; unmonitored artists are left alone. Toggle ON/OFF here to add or remove an
      artist from that rotation.
    </DownloadsTabHint>

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
        <span class="shrink-0 text-base text-stone-100/55">
          {{ monitoredCount.toLocaleString() }} / {{ total.toLocaleString() }} monitored
        </span>
      </div>
    </div>

    <DownloadsSelectionBar
      :count="selected.size"
      :loading="bulkBusy"
      :actions="bulkActions"
      @action="onBulkAction"
      @cancel="selected = new Set()"
    />

    <UiLoadingBlock v-if="loading" />

    <UiEmptyState v-else-if="items.length === 0" message="No artists found" />

    <SlimTable v-else>
      <SlimTableHeader>
        <th :class="cx(data.th, 'w-10 text-left')">
          <UiCheckbox :model-value="allChecked" aria-label="Select all rows" @update:model-value="toggleAll" />
        </th>
        <SortableTh label="Artist" sort-key="name" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
        <SortableTh label="Missing / MB total" sort-key="missingReleases" align="right" :active-key="sortKey" :dir="sortDir" @sort="onSort" />
        <th :class="cx(data.th, 'text-right')">
          <div class="flex items-center justify-end gap-1.5">
            <button
              type="button"
              class="inline-flex flex-row-reverse items-center gap-1 transition-colors duration-150 hover:text-stone-100"
              :class="sortKey === 'monitored' ? 'text-stone-100/60' : ''"
              title="Sort by monitoring"
              @click="onSort('monitored')"
            >
              Monitoring
              <component
                :is="sortKey === 'monitored' ? (sortDir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown"
                :size="12"
                :class="sortKey === 'monitored' ? 'text-amber-400' : 'text-stone-100/50'"
              />
            </button>
            <Popover trigger="hover" teleport placement="bottom-end">
              <template #trigger>
                <button type="button" aria-label="What does monitoring do?" class="cursor-help text-stone-100/25 hover:text-stone-100/55">
                  <CircleHelp :size="13" />
                </button>
              </template>
              <template #content>
                <div :class="cx(surface.popover, 'w-72 p-3 text-left')">
                  <p class="text-sm font-normal normal-case tracking-normal text-stone-100/60">
                    Monitoring an artist lets dmp automatically search Soulseek for the releases
                    missing from your library and download them in the background. Approved
                    downloads wait in "Ready to merge" until you merge them in.
                  </p>
                </div>
              </template>
            </Popover>
          </div>
        </th>
      </SlimTableHeader>
      <SlimTableBody>
        <SlimTableRow
          v-for="artist in items"
          :key="artist.id"
          :active="selected.has(artist.id)"
        >
          <td :class="data.td" @click.stop="captureRowClick">
            <UiCheckbox :model-value="selected.has(artist.id)" :aria-label="`Select ${artist.name}`" @update:model-value="toggleRow(artist.id)" />
          </td>
          <td :class="data.td">
            <NuxtLink :to="`/artist/${artist.slug}`" class="text-stone-100 transition-colors duration-150 hover:text-amber-400">
              {{ artist.name }}
            </NuxtLink>
          </td>
          <td :class="cx(data.td, 'text-right tabular-nums')">
            <template v-if="artist.totalReleases > 0">
              <span :class="artist.missingReleases > 0 ? 'font-medium text-amber-400' : 'text-stone-100/55'">{{ artist.missingReleases }}</span>
              <span class="text-stone-100/25"> / {{ artist.totalReleases }}</span>
            </template>
            <span v-else class="text-stone-100/25">—</span>
          </td>
          <td :class="cx(data.td, 'text-right')" @click.stop>
            <button
              type="button"
              :class="sw('chip', artist.monitored)"
              class="disabled:opacity-50 disabled:pointer-events-none"
              :disabled="busyIds.has(artist.id)"
              :title="artist.monitored ? `Stop monitoring ${artist.name}` : `Monitor ${artist.name}`"
              @click="toggleMonitor(artist)"
            >
              <!-- No icon on the settled states: the whole column is these two words, so an icon
                   on only one of them makes the pair look like different controls rather than one
                   toggle's two positions. The spinner is the exception - it is a third state. -->
              <Loader2 v-if="busyIds.has(artist.id)" :size="13" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin" />
              {{ artist.monitored ? 'ON' : 'OFF' }}
            </button>
          </td>
        </SlimTableRow>
      </SlimTableBody>
    </SlimTable>

    <InfiniteScroll @load="loadMore" />

    <UiLoadingBlock v-if="loadingMore" size="inline" />

    <ConfirmDialog
      v-model="confirmOpen"
      title="Update monitoring"
      :message="confirmMessage"
      :confirm-label="confirmLabel"
      :icon="pendingMonitor ? Radar : EyeOff"
      @confirm="confirmBulk"
    />
  </div>
</template>
