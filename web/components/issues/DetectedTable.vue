<script setup lang="ts">
import type { IssueColumn, IssueType } from '~/types/issues'
import { folderPathOf } from '~/helpers/issueColumns'
import { data } from '~/helpers/ui'

defineProps<{
  type: IssueType
  columns: IssueColumn[]
  items: any[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  sort?: string
  order?: 'asc' | 'desc'
  selected: Set<string>
  selectable: boolean
}>()

defineEmits<{
  'update:selected': [selected: Set<string>]
  sort: [key: string]
  page: [page: number]
  edit: [id: string, key: string, value: unknown]
}>()
</script>

<template>
  <IssuesIssueTable
    :type="type"
    :columns="columns"
    :items="items"
    :total="total"
    :page="page"
    :page-size="pageSize"
    :loading="loading"
    :sort="sort"
    :order="order"
    :selected="selected"
    :selectable="selectable"
    @update:selected="$emit('update:selected', $event)"
    @sort="$emit('sort', $event)"
    @page="$emit('page', $event)"
    @edit="(id, key, value) => $emit('edit', id, key, value)"
  >
    <template #cell-artist_name="{ item }">
      <NuxtLink
        v-if="item.artist"
        :to="`/artist/${item.artist.slug}`"
        class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
      >
        {{ item.artist.name }}
      </NuxtLink>
      <span v-else class="text-stone-100/20">-</span>
    </template>

    <template #cell-confidence="{ item }">
      <IssuesConfidenceBadge :confidence="item.confidence" />
    </template>

    <template #cell-folder="{ item }">
      <span class="truncate text-xs text-stone-100/55" :title="folderPathOf(item)">
        {{ folderPathOf(item) }}
      </span>
    </template>

    <template #cell-proposedParts="{ item }">
      <div class="flex flex-wrap gap-1">
        <span
          v-for="part in item.proposedParts"
          :key="part"
          :class="data.tag"
        >{{ part }}</span>
      </div>
    </template>

    <template #cell-reason="{ item }">
      <span :class="data.tag">{{ item.reason }}</span>
    </template>

    <template #cell-artist_createdAt="{ item }">
      <span class="text-xs text-stone-100/55">{{ new Date(item.artist.createdAt).toLocaleDateString() }}</span>
    </template>

    <template #cell-artist_musicbrainzId="{ item }">
      <span :class="item.artist.musicbrainzId ? 'text-success' : 'text-stone-100/25'">
        {{ item.artist.musicbrainzId ? 'Yes' : 'No' }}
      </span>
    </template>

    <template #cell-artistA_name="{ item }">
      <NuxtLink :to="`/artist/${item.artistA.slug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150">
        {{ item.artistA.name }}
      </NuxtLink>
    </template>

    <template #cell-artistB_name="{ item }">
      <NuxtLink :to="`/artist/${item.artistB.slug}`" class="text-stone-100 hover:text-amber-400 transition-colors duration-150">
        {{ item.artistB.name }}
      </NuxtLink>
    </template>

    <template #cell-releaseA_title="{ item }">
      <NuxtLink
        v-if="item.releaseA.artist"
        :to="`/artist/${item.releaseA.artist.slug}`"
        class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
        :title="item.releaseA.folderPath"
      >
        {{ item.releaseA.title }}
      </NuxtLink>
      <span v-else class="truncate text-stone-100/55" :title="item.releaseA.folderPath">{{ item.releaseA.title }}</span>
    </template>

    <template #cell-releaseB_title="{ item }">
      <NuxtLink
        v-if="item.releaseB.artist"
        :to="`/artist/${item.releaseB.artist.slug}`"
        class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
        :title="item.releaseB.folderPath"
      >
        {{ item.releaseB.title }}
      </NuxtLink>
      <span v-else class="truncate text-stone-100/55" :title="item.releaseB.folderPath">{{ item.releaseB.title }}</span>
    </template>

    <template #cell-releaseA_trackCount="{ item }">
      <span class="text-xs text-stone-100/55 tabular-nums">{{ item.releaseA.trackCount }}</span>
    </template>

    <template #cell-releaseB_trackCount="{ item }">
      <span class="text-xs text-stone-100/55 tabular-nums">{{ item.releaseB.trackCount }}</span>
    </template>

    <template #cell-releaseA_release_title="{ item }">
      <span class="text-xs text-stone-100/60">{{ item.releaseA.release?.title ?? '-' }}</span>
    </template>

    <template #cell-missingFields="{ item }">
      <div class="flex flex-wrap gap-1">
        <template v-if="type === 'enrichment'">
          <IssuesEnrichmentFieldBadge
            v-for="f in item.missingFields"
            :key="f"
            :field="f"
          />
        </template>
        <template v-else>
          <span
            v-for="f in item.missingFields"
            :key="f"
            class="inline-flex items-center rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger"
          >{{ f }}</span>
        </template>
      </div>
    </template>

    <template #cell-proposedValues="{ item }">
      <span v-if="item.proposedValues" class="text-xs text-success">
        {{ Object.keys(item.proposedValues).join(', ') }}
      </span>
      <span v-else class="text-xs text-stone-100/25">manual</span>
    </template>

    <template #cell-localRelease_title="{ item }">
      <NuxtLink
        v-if="item.localRelease"
        :to="`/artist/${item.artist?.slug}`"
        class="text-stone-100 hover:text-amber-400 transition-colors duration-150"
      >
        {{ item.localRelease.title }}
      </NuxtLink>
      <span v-else class="text-stone-100/20">-</span>
    </template>

    <template #cell-_resync="{ item }">
      <UiButtonRefresh
        v-if="item.missingFields?.includes('mbRelease') && item.artist"
        :only="[item.artist.name]"
        :folders="item.localRelease?.folderPath ? [item.localRelease.folderPath] : undefined"
      />
    </template>
  </IssuesIssueTable>
</template>
