<script setup lang="ts">
import { Loader2, Clock } from 'lucide-vue-next'
import {
  Chart,
  RadarController,
  RadialLinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js'
import type { DecadeStats } from '~/types/labs'
import { cssVar } from '~/helpers/theme'
import { surface, sw, typography } from '~/helpers/ui'

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

definePageMeta({ layout: 'labs' })

const { data: decades, status } = useFetch<DecadeStats[]>('/api/labs/decades/stats')

const selectedDecades = ref<string[]>([])
const radarCanvas = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null

const availableDecades = computed(() => decades.value?.map((d) => d.decade) || [])

// One ramp per selectable decade slot, in this order.
const SERIES_TOKENS = ['amber-400', 'green-500', 'orange-400', 'red-400', 'violet-400'] as const
// The same five as literal utilities for the breakdown dots and the legend. They have to be written
// out rather than interpolated: Tailwind scans source text, so `bg-${token}` produces no class.
// cssVar() below reads computed style, which only exists on the client - the chart is rendered on
// mount, but the dots render during SSR too, so they cannot share that path.
const SERIES_DOTS = ['bg-amber-400', 'bg-green-500', 'bg-orange-400', 'bg-red-400', 'bg-violet-400'] as const

// Read live off the theme instead of hard-coded rgba() literals, so a token change here
// doesn't silently drift from the rest of the app.
const colors = computed(() => SERIES_TOKENS.map((token) => {
  const border = cssVar(`--color-${token}`)
  return { bg: `color-mix(in oklch, ${border} 20%, transparent)`, border }
}))

// The breakdown rows and the legend both key off the chart's dataset order, so a decade's dot is
// the colour of its line.
const selectedSeries = computed(() =>
  (decades.value ?? [])
    .filter(d => selectedDecades.value.includes(d.decade))
    .map((decade, i) => ({ decade, dot: SERIES_DOTS[i % SERIES_DOTS.length]! })),
)

const normalize = (value: number, max: number) => (max > 0 ? (value / max) * 100 : 0)

const renderChart = () => {
  if (!radarCanvas.value || !decades.value || selectedDecades.value.length === 0) {
    chart?.destroy()
    chart = null
    return
  }

  const selected = decades.value.filter((d) => selectedDecades.value.includes(d.decade))
  const all = decades.value

  const maxReleases = Math.max(...all.map((d) => d.releaseCount))
  const maxTracks = Math.max(...all.map((d) => d.trackCount))
  const maxArtists = Math.max(...all.map((d) => d.artistCount))
  const maxDuration = Math.max(...all.map((d) => d.avgDuration))
  const maxBitrate = Math.max(...all.map((d) => d.avgBitrate))
  const maxPlays = Math.max(...all.map((d) => d.totalPlayCount))

  const labels = ['Releases', 'Tracks', 'Artists', 'Avg Length', 'Avg Bitrate', 'Total Plays']

  const datasets = selected.map((d, i) => ({
    label: d.decade,
    data: [
      normalize(d.releaseCount, maxReleases),
      normalize(d.trackCount, maxTracks),
      normalize(d.artistCount, maxArtists),
      normalize(d.avgDuration, maxDuration),
      normalize(d.avgBitrate, maxBitrate),
      normalize(d.totalPlayCount, maxPlays),
    ],
    backgroundColor: colors.value[i % colors.value.length]!.bg,
    borderColor: colors.value[i % colors.value.length]!.border,
    borderWidth: 2,
    pointBackgroundColor: colors.value[i % colors.value.length]!.border,
    pointRadius: 3,
  }))

  chart?.destroy()
  chart = new Chart(radarCanvas.value, {
    type: 'radar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { display: false },
          grid: { color: `color-mix(in oklch, ${cssVar('--color-stone-100')} 8%, transparent)` },
          angleLines: { color: `color-mix(in oklch, ${cssVar('--color-stone-100')} 8%, transparent)` },
          pointLabels: { color: `color-mix(in oklch, ${cssVar('--color-stone-100')} 60%, transparent)`, font: { size: 11 } },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: `color-mix(in oklch, ${cssVar('--color-stone-100')} 70%, transparent)`, padding: 16 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const decadeData = selected[ctx.datasetIndex]
              if (!decadeData) {
                return ''
              }
              const raw = [
                decadeData.releaseCount,
                decadeData.trackCount,
                decadeData.artistCount,
                `${Math.round(decadeData.avgDuration / 1000)}s`,
                `${decadeData.avgBitrate} kbps`,
                decadeData.totalPlayCount,
              ]
              return `${ctx.dataset.label}: ${raw[ctx.dataIndex]}`
            },
          },
        },
      },
    },
  })
}

const toggleDecade = (decade: string) => {
  const idx = selectedDecades.value.indexOf(decade)
  if (idx >= 0) {
    selectedDecades.value.splice(idx, 1)
  } else {
    selectedDecades.value.push(decade)
  }
}

const formatDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

watch(selectedDecades, () => nextTick(renderChart), { deep: true })

watch(decades, (val) => {
  if (val && val.length > 0) {
    const sorted = [...val].sort((a, b) => b.releaseCount - a.releaseCount)
    selectedDecades.value = sorted.slice(0, 3).map((d) => d.decade)
  }
})

onUnmounted(() => {
  chart?.destroy()
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <LabsBackLink />

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="flex flex-col gap-6 lg:col-span-2">
        <div class="rounded-xl border border-stone-100/6 bg-stone-900 p-5">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-amber-400/10">
              <Clock :size="20" class="text-amber-400" />
            </div>
            <div>
              <h2 class="text-lg font-semibold text-stone-100">Decade DNA</h2>
              <p class="text-sm text-stone-100/40">Compare your collection across decades</p>
            </div>
          </div>

          <p class="mb-4 text-base leading-relaxed text-stone-100/60">
            Pick up to four decades to overlay. Every axis is normalised to the strongest decade in the library.
          </p>

          <div v-if="status === 'pending'" class="flex items-center gap-2 text-base text-stone-100/60">
            <Loader2 :size="14" class="animate-spin text-amber-400" />
            Loading...
          </div>

          <div v-else class="flex flex-wrap gap-2">
            <button
              v-for="decade in availableDecades"
              :key="decade"
              type="button"
              :class="sw('chip', selectedDecades.includes(decade))"
              @click="toggleDecade(decade)"
            >
              {{ decade }}
            </button>
          </div>
        </div>

        <div v-if="selectedSeries.length > 0" :class="surface.card">
          <div :class="surface.cardHead">
            <span :class="typography.sectionLabel">Breakdown</span>
          </div>
          <div class="flex flex-col gap-3 p-[18px]">
            <div
              v-for="{ decade: d, dot } in selectedSeries"
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
                <div>{{ formatDuration(d.avgDuration) }} avg</div>
                <div>{{ d.avgBitrate }} kbps</div>
                <div>{{ d.totalPlayCount.toLocaleString() }} plays</div>
              </div>
              <div v-if="d.topGenres.length > 0" class="mt-2.5 flex flex-wrap gap-1">
                <span
                  v-for="g in d.topGenres.slice(0, 3)"
                  :key="g.name"
                  class="rounded-full bg-stone-800 px-2 py-0.5 text-2xs text-stone-100/60"
                >
                  {{ g.name }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="lg:col-span-3">
        <div class="sticky top-20 flex h-[600px] flex-col rounded-xl border border-stone-100/6 bg-stone-900 p-6">
          <UiEmptyState v-if="selectedDecades.length === 0" class="m-auto" message="Select decades to compare" />
          <canvas v-show="selectedDecades.length > 0" ref="radarCanvas" class="min-h-0 w-full flex-1" />
          <div v-if="selectedSeries.length > 0" class="mt-4 flex flex-wrap items-center justify-center gap-4">
            <span v-for="{ decade: d, dot } in selectedSeries" :key="d.decade" class="flex items-center gap-1.5 text-sm text-stone-100/60">
              <span class="size-2 rounded-full" :class="dot" />
              {{ d.decade }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
