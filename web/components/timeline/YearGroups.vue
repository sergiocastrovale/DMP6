<script setup lang="ts">
import { LucideMusic, Loader2 } from 'lucide-vue-next'
import type { TimelineYearGroup } from '~/types/timeline'
import { grid, ICON_STROKE_WIDTH } from '~/helpers/ui'

defineProps<{
  groups: TimelineYearGroup[]
  total: number
  hasMore: boolean
  loadingMore: boolean
}>()

defineEmits<{
  'load-more': []
}>()

const { releaseImage } = useImageUrl()

const releasesLabel = (count: number) => `${count} ${count === 1 ? 'release' : 'releases'}`
</script>

<template>
  <div class="mt-6 flex flex-col gap-10 lg:gap-0 lg:relative lg:pl-[11rem]">
    <div class="hidden lg:block absolute left-28 top-1 bottom-0 w-px bg-stone-800" />

    <div v-for="group in groups" :key="group.year" class="flex flex-col gap-3 lg:relative lg:gap-0 lg:pb-12">
      <div class="flex items-baseline gap-2 lg:hidden">
        <h3 class="font-display text-xl font-bold text-stone-100 tabular-nums">{{ group.year || '????' }}</h3>
        <span class="text-sm text-stone-100/55">{{ releasesLabel(group.count) }}</span>
      </div>

      <div class="hidden lg:block absolute -left-[11rem] top-0 w-28 pr-4 text-right">
        <div class="font-display text-3xl font-bold text-stone-100 leading-none tabular-nums">{{ group.year || '????' }}</div>
        <div class="mt-1 text-xs font-medium text-stone-100/55">{{ releasesLabel(group.count) }}</div>
      </div>

      <div class="hidden lg:block absolute -left-[4.4375rem] top-1.5 size-3.5 rounded-full bg-amber-400 ring-[3px] ring-amber-400/30" />

      <div :class="grid.auto">
        <Block
          v-for="release in group.releases"
          :id="release.id"
          :key="release.id"
          :title="release.title"
          :title-link="`/artist/${release.artist!.slug}?releaseId=${release.id}`"
          :subtitle="release.artist!.name"
          :subtitle-link="`/artist/${release.artist!.slug}`"
          :image="releaseImage(release)"
          playable
          :release-id="release.id"
          :artist-slug="release.artist!.slug"
        />
      </div>
    </div>

    <div v-if="hasMore" class="flex items-center justify-center gap-2 py-4">
      <InfiniteScroll margin="200px" @load="$emit('load-more')" />
      <Loader2 v-if="loadingMore" :size="18" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-stone-100/55" />
    </div>

    <UiEmptyState
      v-if="groups.length === 0"
      :icon="LucideMusic"
      message="No releases in this period"
    />

    <div v-if="total > 0" class="text-center text-xs text-stone-100/50">
      {{ releasesLabel(total) }}
    </div>
  </div>
</template>
