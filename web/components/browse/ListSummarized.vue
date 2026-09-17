<script setup lang="ts">
import { Link } from 'lucide-vue-next'
import type { DataTableColumn } from '~/types/ui'
import { cx, typography } from '~/helpers/ui'
import { useBrowseStore } from '~/stores/browse'
import { musicbrainzArtistUrl } from '~/helpers/functions'

const store = useBrowseStore()
const { artistImage } = useImageUrl()

const columns: DataTableColumn[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'musicbrainzId', label: 'MusicBrainz ID' },
  { key: 'releases', label: 'Releases', sortable: true, align: 'center' },
  { key: 'tracks', label: 'Tracks', sortable: true, align: 'center' },
  { key: 'playCount', label: 'Plays', sortable: true, align: 'center' },
]

const showing = computed(() => store.artists.length)

const sort = computed(() => ({ key: store.sortBy, dir: store.sortDir }))
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
        <NuxtLink :to="`/artist/${row.slug}`" class="group/name inline-flex items-center gap-3">
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
          <span class="truncate text-sm font-medium text-stone-100 group-hover/name:text-amber-400">{{ row.name }}</span>
        </NuxtLink>
      </template>

      <template #cell-musicbrainzId="{ row }">
        <a
          v-if="row.musicbrainzId"
          :href="musicbrainzArtistUrl(row.musicbrainzId)"
          target="_blank"
          rel="noopener noreferrer"
          :class="cx(typography.meta, 'flex items-center gap-1.5 hover:text-amber-400')"
        >
          {{ row.musicbrainzId }}
          <Link :size="12" />
        </a>
        <span v-else :class="typography.meta">—</span>
      </template>

      <template #cell-releases="{ row }">
        <span :class="typography.meta">{{ row.releaseCount }}</span>
      </template>

      <template #cell-tracks="{ row }">
        <span :class="typography.meta">{{ row.totalTracks }}</span>
      </template>

      <template #cell-playCount="{ row }">
        <span :class="typography.meta">{{ row.totalPlayCount }}</span>
      </template>
    </DataTable>

    <InfiniteScroll @load="store.loadMore()" />

    <UiLoadingBlock v-if="store.loadingMore" size="inline" />

    <div v-if="!store.loading && store.artists.length > 0" class="text-center text-xs text-stone-100/55">
      Showing {{ showing }} of {{ store.total }} artists
    </div>
  </div>
</template>
