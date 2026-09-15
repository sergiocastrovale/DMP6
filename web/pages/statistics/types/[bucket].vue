<script setup lang="ts">
import type { DataTableColumn } from '~/types/ui'
import { releaseTypeBuckets } from '~/helpers/constants'
import { formatDate } from '~/helpers/functions'
import type { ReleaseTypeBucketId } from '~/types/stats'

const BUCKET_IDS = new Set(releaseTypeBuckets.map(b => b.id))

definePageMeta({
  layout: 'admin',
  validate: route => BUCKET_IDS.has(route.params.bucket as ReleaseTypeBucketId) && typeof route.query.artist === 'string',
})

const route = useRoute()
const bucket = route.params.bucket as ReleaseTypeBucketId
const artistSlug = route.query.artist as string
// Passed by TypesPage.vue's link so this page doesn't need its own request just to show a title -
// falls back to the slug if someone lands here with a hand-typed URL.
const artistName = (route.query.name as string) || artistSlug
const bucketLabel = releaseTypeBuckets.find(b => b.id === bucket)!.label

useTitle('Statistics', `${artistName} — ${bucketLabel}`)

const columns: DataTableColumn[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'year', label: 'Year', sortable: true, align: 'center' },
  { key: 'updatedAt', label: 'Last updated', sortable: true, align: 'center' },
]
</script>

<template>
  <StatisticsStatPage
    :title="`${artistName} — ${bucketLabel}`"
    api-type="type-detail"
    label="releases"
    default-sort="year"
    default-order="desc"
    :columns="columns"
    :extra-query="{ bucket, artist: artistSlug }"
    back-to="/statistics/types"
  >
    <template #cell-updatedAt="{ value }">
      <span class="text-stone-100/70">{{ value ? formatDate(value as string) : '—' }}</span>
    </template>
  </StatisticsStatPage>
</template>
