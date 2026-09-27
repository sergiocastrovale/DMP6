<script setup lang="ts">
import { ExternalLink, Plus } from 'lucide-vue-next'
import type { MbArtistSearchRow } from '~/types/artist'
import { cx, data } from '~/helpers/ui'
import { musicbrainzArtistUrl } from '~/helpers/functions'

defineProps<{
  items: MbArtistSearchRow[]
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
      <th :class="cx(data.th, 'text-left')">Description</th>
      <th :class="cx(data.th, 'text-right')" />
    </SlimTableHeader>
    <SlimTableBody>
      <SlimTableRow v-for="row in items" :key="row.mbid" :muted="!!row.existing">
        <td :class="data.td">
          <div class="flex items-center gap-1.5">
            <span class="text-stone-100">{{ row.name }}</span>
            <DataTableAction
              :icon="ExternalLink"
              label="View on MusicBrainz"
              :href="musicbrainzArtistUrl(row.mbid)"
            />
          </div>
        </td>
        <td :class="cx(data.td, 'text-stone-100/55')">
          {{ [row.disambiguation, row.country, row.type].filter(Boolean).join(' · ') || '—' }}
          <p v-if="row.namesake" class="text-xs text-amber-400/80">
            <NuxtLink :to="`/artist/${row.namesake.slug}`" class="underline">Another {{ row.name }}</NuxtLink>
            is in your library.
            {{ row.namesake.identified
              ? 'This one is added separately - each gets its own page.'
              : 'It is not identified yet: adding checks whether it is this one first.' }}
          </p>
        </td>
        <td :class="cx(data.td, 'text-right')">
          <NuxtLink
            v-if="row.existing"
            :to="`/artist/${row.existing.slug}`"
            :class="data.tag"
            class="hover:text-amber-400"
          >
            In library
          </NuxtLink>
          <UiButton
            v-else
            :icon="Plus"
            variant="primary"
            size="md"
            :loading="addingMbid === row.mbid"
            :disabled="addingMbid !== null && addingMbid !== row.mbid"
            @click="$emit('add', row)"
          >
            Add to catalogue
          </UiButton>
        </td>
      </SlimTableRow>
    </SlimTableBody>
  </SlimTable>
</template>
