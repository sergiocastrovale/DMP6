<script setup lang="ts">
import { cx, layout } from '~/helpers/ui'

useTitle('Timeline')

const {
  loading, decades, selectedDecade, selectedYear, decadeData, loadingDecade, loadingMore,
  releasesByYear, selectDecade, selectYear, loadMore,
} = useTimelinePage()
</script>

<template>
  <div :class="cx(layout.page)">
    <PageTitle text="Timeline" />

    <UiLoadingBlock v-if="loading" />

    <template v-else-if="decades.length > 0">
      <TimelineFilters
        :decades="decades"
        :selected-decade="selectedDecade"
        :years="decadeData?.years ?? []"
        :selected-year="selectedYear"
        @select-decade="selectDecade"
        @select-year="selectYear"
      />

      <UiLoadingBlock v-if="loadingDecade" />

      <TimelineYearGroups
        v-else-if="decadeData"
        :groups="releasesByYear"
        :total="decadeData.total"
        :has-more="decadeData.hasMore"
        :loading-more="loadingMore"
        @load-more="loadMore"
      />
    </template>

    <UiEmptyState v-else message="No releases with year information found" />
  </div>
</template>
