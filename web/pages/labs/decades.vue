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

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

definePageMeta({ layout: 'labs' })

const { data: decades, status } = useFetch<DecadeStats[]>('/api/labs/decades/stats')

const selectedDecades = ref<string[]>([])
const radarCanvas = ref<HTMLCanvasElement | null>(null)
let chart: Chart | null = null

const availableDecades = computed(() => decades.value?.map((d) => d.decade) || [])

const colors = [
  { bg: 'rgba(99, 155, 255, 0.2)', border: 'rgba(99, 155, 255, 0.8)' },
  { bg: 'rgba(255, 99, 132, 0.2)', border: 'rgba(255, 99, 132, 0.8)' },
  { bg: 'rgba(75, 220, 150, 0.2)', border: 'rgba(75, 220, 150, 0.8)' },
  { bg: 'rgba(255, 206, 86, 0.2)', border: 'rgba(255, 206, 86, 0.8)' },
  { bg: 'rgba(153, 102, 255, 0.2)', border: 'rgba(153, 102, 255, 0.8)' },
  { bg: 'rgba(255, 159, 64, 0.2)', border: 'rgba(255, 159, 64, 0.8)' },
]

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
    backgroundColor: colors[i % colors.length]!.bg,
    borderColor: colors[i % colors.length]!.border,
    borderWidth: 2,
    pointBackgroundColor: colors[i % colors.length]!.border,
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
          grid: { color: 'rgba(255, 255, 255, 0.08)' },
          angleLines: { color: 'rgba(255, 255, 255, 0.08)' },
          pointLabels: { color: 'rgba(255, 255, 255, 0.6)', font: { size: 11 } },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: 'rgba(255, 255, 255, 0.7)', padding: 16 },
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
</script>

<template>
  <div class="grid h-full gap-6 lg:grid-cols-5">
    <div class="flex flex-col gap-6 lg:col-span-2">
      <div class="rounded-lg border border-rule bg-bg-1 p-5">
        <div class="mb-4 flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-accent/10">
            <Clock :size="20" class="text-accent" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-ink">Decade DNA</h2>
            <p class="text-xs text-ink-2">Compare your collection across decades</p>
          </div>
        </div>

        <p class="mb-4 text-sm leading-relaxed text-ink-2">
          Select decades to compare on the radar chart. Each axis is normalized to the max value across all decades.
        </p>

        <div v-if="status === 'pending'" class="flex items-center gap-2 text-sm text-ink-2">
          <Loader2 :size="14" class="animate-spin text-accent" />
          Loading...
        </div>

        <div v-else class="flex flex-wrap gap-2">
          <button
            v-for="decade in availableDecades"
            :key="decade"
            class="rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
            :class="selectedDecades.includes(decade)
              ? 'border-accent/50 bg-accent/20 text-accent'
              : 'border-rule bg-bg-2 text-ink-2 hover:text-ink'"
            @click="toggleDecade(decade)"
          >
            {{ decade }}
          </button>
        </div>
      </div>

      <div v-if="decades && decades.length > 0" class="rounded-lg border border-rule bg-bg-1 p-5">
        <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-ink0">
          Breakdown
        </h3>
        <div class="divide-y divide-rule">
          <div
            v-for="d in decades.filter((d) => selectedDecades.includes(d.decade))"
            :key="d.decade"
            class="py-3 first:pt-0 last:pb-0"
          >
            <div class="mb-1 text-sm font-medium text-ink">{{ d.decade }}</div>
            <div class="grid grid-cols-3 gap-2 text-xs text-ink-2">
              <div>{{ d.releaseCount }} releases</div>
              <div>{{ d.trackCount }} tracks</div>
              <div>{{ d.artistCount }} artists</div>
              <div>{{ formatDuration(d.avgDuration) }} avg</div>
              <div>{{ d.avgBitrate }} kbps</div>
              <div>{{ d.totalPlayCount }} plays</div>
            </div>
            <div v-if="d.topGenres.length > 0" class="mt-1.5 flex flex-wrap gap-1">
              <span
                v-for="g in d.topGenres.slice(0, 3)"
                :key="g.name"
                class="rounded-full bg-bg-2 px-2 py-0.5 text-[10px] text-ink-2"
              >
                {{ g.name }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="lg:col-span-3">
      <div class="sticky top-20 flex h-[600px] items-center justify-center rounded-lg border border-rule bg-bg-1 p-6">
        <div v-if="selectedDecades.length === 0" class="text-sm text-ink-2">
          Select decades to compare
        </div>
        <canvas v-show="selectedDecades.length > 0" ref="radarCanvas" class="h-full w-full" />
      </div>
    </div>
  </div>
</template>
