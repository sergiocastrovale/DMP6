<script setup lang="ts">
import type { DecadeStats } from '~/types/labs'
import { formatDecadeDuration } from '~/helpers/decadeRadar'
import { surface, typography } from '~/helpers/ui'

defineProps<{
  series: { decade: DecadeStats, dot: string }[]
}>()
</script>

<template>
  <div :class="surface.card">
    <div :class="surface.cardHead">
      <span :class="typography.sectionLabel">Breakdown</span>
    </div>
    <div class="flex flex-col gap-3 p-[18px]">
      <div
        v-for="{ decade: d, dot } in series"
        :key="d.decade"
        :class="[surface.panel, 'p-4']"
      >
        <div class="mb-2 flex items-center gap-2">
          <span class="size-2 shrink-0 rounded-full" :class="dot" />
          <span class="text-base font-semibold text-stone-100">{{ d.decade }}</span>
        </div>
        <div :class="[typography.meta, 'grid grid-cols-2 gap-x-4 gap-y-1']">
          <div>{{ d.releaseCount.toLocaleString() }} releases</div>
          <div>{{ d.trackCount.toLocaleString() }} tracks</div>
          <div>{{ d.artistCount.toLocaleString() }} artists</div>
          <div>{{ formatDecadeDuration(d.avgDuration) }} avg</div>
          <div>{{ d.avgBitrate }} kbps</div>
          <div>{{ d.totalPlayCount.toLocaleString() }} plays</div>
        </div>
        <div v-if="d.topGenres.length > 0" class="mt-2.5 flex flex-wrap gap-1">
          <span
            v-for="g in d.topGenres.slice(0, 3)"
            :key="g.name"
            class="rounded-full bg-stone-800 px-2 py-0.5 text-xs text-stone-100/60"
          >
            {{ g.name }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
