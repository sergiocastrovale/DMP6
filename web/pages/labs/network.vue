<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { cx, ICON_STROKE_WIDTH, layout } from '~/helpers/ui'

useTitle('Labs', 'Artist Network')

definePageMeta({ layout: 'labs' })

const {
  loading, graphData, minShared, selectedArtist,
  searchQuery, searchResults, searchOpen, blurSearch,
  selectArtist, clearSearch,
} = useNetworkGraph()

const svgContainer = ref<HTMLElement | null>(null)
const { tooltip, linkTooltip } = useForceGraph(svgContainer, graphData, {
  // The focused artist opens its page; any other node re-centres the graph on it.
  onNodeClick: node => node.isFocus ? navigateTo(`/artist/${node.slug}`) : selectArtist({ id: node.id, name: node.name }),
})
</script>

<template>
  <div :class="cx(layout.page, 'max-w-none')">
    <LabsBackLink />

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="flex flex-col gap-6 lg:col-span-1">
        <LabsNetworkControls
          v-model:query="searchQuery"
          v-model:min-shared="minShared"
          v-model:search-open="searchOpen"
          :results="searchResults"
          :selected="selectedArtist"
          :artist-count="graphData?.nodes.length ?? 0"
          :link-count="graphData?.links.length ?? 0"
          @select="selectArtist"
          @clear="clearSearch"
          @blur="blurSearch"
        />
      </div>

      <div class="relative lg:col-span-4">
        <div
          v-if="loading"
          class="flex h-full min-h-[600px] items-center justify-center rounded-xl border border-stone-100/10 bg-stone-900"
        >
          <div class="flex items-center gap-2 text-base text-stone-100/60">
            <Loader2 :size="16" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-amber-400" />
            Loading network...
          </div>
        </div>

        <UiEmptyState
          v-else-if="!graphData || graphData.nodes.length === 0"
          :message="selectedArtist ? 'No collaborations found for this artist.' : 'No connections found. Try lowering the threshold.'"
          class="flex h-full min-h-[600px] flex-col items-center justify-center rounded-xl border border-stone-100/10 bg-stone-900"
        />

        <div
          v-else
          ref="svgContainer"
          class="h-full min-h-[600px] overflow-hidden rounded-xl border border-stone-100/10 bg-stone-900"
        />
      </div>
    </div>

    <LabsNetworkTooltips :node="tooltip" :link="linkTooltip" />
  </div>
</template>
