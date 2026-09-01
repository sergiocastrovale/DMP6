<script setup lang="ts">
import type { DataTableColumn } from '~/components/DataTable.vue'
import type { ArtistListItem } from '~/types/artist'
import { getScoreRange } from '~/helpers/constants'
import { cx, outlinePill, typography } from '~/helpers/ui'
import { useBrowseStore } from '~/stores/browse'

const store = useBrowseStore()
const { artistImage } = useImageUrl()

// A bare "6" in a Releases column is ambiguous at a glance once four numeric columns sit side by
// side; the unit carries which column you are reading without a second look at the header.
const counted = (value: number, singular: string, plural = `${singular}s`) =>
  `${value.toLocaleString()} ${value === 1 ? singular : plural}`

const columns: DataTableColumn[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'releases', label: 'Releases', sortable: true, align: 'right', width: '110px' },
  { key: 'tracks', label: 'Tracks', sortable: true, align: 'right', width: '100px' },
  { key: 'completeness', label: 'Completeness', sortable: true, align: 'right', width: '140px' },
  { key: 'playCount', label: 'Plays', sortable: true, align: 'right', width: '100px' },
]

// The real direction, not a per-field guess: the header arrows and the toolbar's direction button
// are two views of one piece of store state, so they can never disagree.
const sort = computed(() => ({ key: store.sortBy, dir: store.sortDir }))

const completenessPct = (artist: ArtistListItem) => {
  const releaseCount = artist.releaseCount ?? 0
  const completeCount = artist.completeCount ?? 0
  return releaseCount === 0 ? 0 : Math.round((completeCount / releaseCount) * 100)
}

const completenessClasses = (artist: ArtistListItem) => {
  const { bgColor, textColor } = getScoreRange(completenessPct(artist))
  return cx(outlinePill, 'border-transparent', bgColor, textColor)
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
            <div v-else class="flex size-full items-center justify-center text-xs font-bold text-stone-100/50">
              {{ row.name.charAt(0).toUpperCase() }}
            </div>
          </div>
          <span class="truncate text-sm font-medium text-stone-100 group-hover:text-amber-400">{{ row.name }}</span>
        </NuxtLink>
      </template>

      <template #cell-releases="{ row }">
        <span :class="typography.meta">{{ counted(row.releaseCount ?? 0, 'release') }}</span>
      </template>

      <template #cell-tracks="{ row }">
        <span :class="typography.meta">{{ counted(row.totalTracks, 'track') }}</span>
      </template>

      <template #cell-completeness="{ row }">
        <span :class="completenessClasses(row)">
          {{ completenessPct(row) }}%
          <!-- The fraction is what makes the percentage readable: 100% off one release and 100%
               off forty are the same number and very different libraries. -->
          <span class="font-normal opacity-60">({{ row.completeCount ?? 0 }}/{{ row.releaseCount ?? 0 }})</span>
        </span>
      </template>

      <template #cell-playCount="{ row }">
        <span :class="typography.meta">{{ counted(row.totalPlayCount, 'play') }}</span>
      </template>
    </DataTable>

    <InfiniteScroll @load="store.loadMore()" />

    <UiLoadingBlock v-if="store.loadingMore" size="inline" />

    <div v-if="!store.loading && store.artists.length > 0" class="text-center text-xs text-stone-100/55">
      Showing {{ store.artists.length }} of {{ store.total }} artists
    </div>
  </div>
</template>
