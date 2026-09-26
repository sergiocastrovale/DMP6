<script setup lang="ts">
import type { IssueColumn, IssueType } from '~/types/issues'
import { folderPathOf, historyAppliedEntries, historyDateOf, historyPreviousEntries } from '~/helpers/issueColumns'

defineProps<{
  type: IssueType
  columns: IssueColumn[]
  items: any[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  selected: Set<string>
  selectable: boolean
}>()

defineEmits<{
  'update:selected': [selected: Set<string>]
  page: [page: number]
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
    :selected="selected"
    :selectable="selectable"
    @update:selected="$emit('update:selected', $event)"
    @page="$emit('page', $event)"
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

    <template #cell-previousValue="{ item }">
      <div class="flex flex-col gap-0.5">
        <span v-for="e in historyPreviousEntries(item)" :key="e.key" class="text-xs text-accent">
          <span class="text-stone-100/55">{{ e.key }}:</span> {{ e.value }}
        </span>
        <span v-if="!historyPreviousEntries(item).length" class="text-xs text-stone-100/20">-</span>
      </div>
    </template>

    <template #cell-appliedValue="{ item }">
      <div class="flex flex-col gap-0.5">
        <span v-for="e in historyAppliedEntries(item)" :key="e.key" class="text-xs text-success">
          <span class="text-stone-100/55">{{ e.key }}:</span> {{ e.value }}
        </span>
        <span v-if="!historyAppliedEntries(item).length" class="text-xs text-stone-100/20">-</span>
      </div>
    </template>

    <template #cell-folder="{ item }">
      <span class="truncate text-xs text-stone-100/55" :title="folderPathOf(item)">
        {{ folderPathOf(item) }}
      </span>
    </template>

    <template #cell-fixedAt="{ item }">
      <span class="text-xs text-stone-100/55">{{ historyDateOf(item) }}</span>
    </template>
  </IssuesIssueTable>
</template>
