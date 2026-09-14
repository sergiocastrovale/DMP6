<script setup lang="ts">
import { ExternalLink, Loader2 } from 'lucide-vue-next'
import type { MbArtistSearchRow } from '~/types/artist'
import { cx, data, ICON_STROKE_WIDTH } from '~/helpers/ui'
import { musicbrainzArtistUrl } from '~/helpers/functions'

defineProps<{
  items: MbArtistSearchRow[]
  counts: Record<string, number | 'error' | undefined>
  addingMbid: string | null
}>()

defineEmits<{
  add: [row: MbArtistSearchRow]
}>()
</script>

<template>
  <SlimTable>
    <SlimTableHeader>
      <th :class="cx(data.th, 'text-left')">Artist</th>
      <th :class="cx(data.th, 'text-center')">Official releases</th>
      <th :class="cx(data.th, 'text-right')" />
    </SlimTableHeader>
    <SlimTableBody>
      <SlimTableRow v-for="row in items" :key="row.mbid">
        <td :class="data.td">
          <div class="flex items-center gap-1.5">
            <span class="text-stone-100">{{ row.name }}</span>
            <DataTableAction
              :icon="ExternalLink"
              label="View on MusicBrainz"
              :href="musicbrainzArtistUrl(row.mbid)"
            />
            <NuxtLink
              v-if="row.existing"
              :to="`/artist/${row.existing.slug}`"
              :class="data.tag"
              class="hover:text-amber-400"
            >
              In library
            </NuxtLink>
          </div>
          <p v-if="row.disambiguation || row.country" class="mt-0.5 text-sm text-stone-100/50">
            {{ [row.disambiguation, row.country].filter(Boolean).join(' · ') }}
          </p>
        </td>
        <td :class="cx(data.td, 'text-center tabular-nums text-stone-100/70')">
          <Loader2 v-if="counts[row.mbid] === undefined" :size="14" :stroke-width="ICON_STROKE_WIDTH" class="mx-auto animate-spin text-stone-100/40" />
          <span v-else-if="counts[row.mbid] === 'error'" class="text-stone-100/25">—</span>
          <span v-else>{{ counts[row.mbid] }}</span>
        </td>
        <td :class="cx(data.td, 'text-right')">
          <UiButton
            variant="secondary"
            size="sm"
            :loading="addingMbid === row.mbid"
            :disabled="addingMbid !== null && addingMbid !== row.mbid"
            @click="$emit('add', row)"
          >
            Add
          </UiButton>
        </td>
      </SlimTableRow>
    </SlimTableBody>
  </SlimTable>
</template>
