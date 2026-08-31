<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'
import type { ArtistListItem } from '~/types/artist'
import { Loader2 } from 'lucide-vue-next'
import { getScoreRange } from '~/helpers/constants'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'
import { useBrowseStore } from '~/stores/browse'

const store = useBrowseStore()
const { artistImage } = useImageUrl()

const columns: DataTableColumn[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'releases', label: 'Releases', sortable: true, align: 'right', width: '110px' },
  { key: 'tracks', label: 'Tracks', sortable: true, align: 'right', width: '100px' },
  { key: 'completeness', label: 'Completeness', sortable: true, align: 'right', width: '140px' },
  { key: 'playCount', label: 'Plays', sortable: true, align: 'right', width: '100px' },
]

const sort = computed(() => ({
  key: store.sortBy,
  dir: store.sortBy === 'name' ? 'asc' as const : 'desc' as const,
}))

const completenessPct = (artist: ArtistListItem) => {
  const releaseCount = artist.releaseCount ?? 0
  const completeCount = artist.completeCount ?? 0
  return releaseCount === 0 ? 0 : Math.round((completeCount / releaseCount) * 100)
}

const completenessClasses = (artist: ArtistListItem) => {
  const { bgColor, textColor } = getScoreRange(completenessPct(artist))
  return `${bgColor} ${textColor}`
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <DataTable
      :columns="columns"
      :rows="store.artists"
      :selectable="false"
      :loading="store.loading"
      :sort="sort"
      empty-message="No artists found."
      empty-hint="Try a different search term or filter."
      @sort="store.setSortBy"
    >
      <template #cell-name="{ row }">
        <NuxtLink :to="`/artist/${row.slug}`" class="group flex min-w-0 items-center gap-3">
          <div class="size-8 shrink-0 overflow-hidden rounded-md bg-stone-800">
            <img
              v-if="artistImage(row)"
              :src="artistImage(row)!"
              :alt="row.name"
              class="size-full object-cover"
              loading="lazy"
            >
            <div v-else class="flex size-full items-center justify-center text-xs font-bold text-stone-100/30">
              {{ row.name.charAt(0).toUpperCase() }}
            </div>
          </div>
          <span class="truncate text-sm font-medium text-stone-100 group-hover:text-amber-400">{{ row.name }}</span>
        </NuxtLink>
      </template>

      <template #cell-releases="{ row }">
        <span class="tabular-nums text-stone-100/70">{{ (row.releaseCount ?? 0).toLocaleString() }}</span>
      </template>

      <template #cell-tracks="{ row }">
        <span class="tabular-nums text-stone-100/70">{{ row.totalTracks.toLocaleString() }}</span>
      </template>

      <template #cell-completeness="{ row }">
        <span class="rounded-full px-2 py-0.5 text-xs font-medium tabular-nums" :class="completenessClasses(row)">
          {{ completenessPct(row) }}%
        </span>
      </template>

      <template #cell-playCount="{ row }">
        <span class="tabular-nums text-stone-100/70">{{ row.totalPlayCount.toLocaleString() }}</span>
      </template>
    </DataTable>

    <InfiniteScroll @load="store.loadMore()" />

    <div v-if="store.loadingMore" class="flex items-center justify-center py-8">
      <Loader2 :size="20" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-stone-100/40" />
    </div>

    <div v-if="!store.loading && store.artists.length > 0" class="text-center text-xs text-stone-100/40">
      Showing {{ store.artists.length }} of {{ store.total }} artists
    </div>
  </div>
</template>
