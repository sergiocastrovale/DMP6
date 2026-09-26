import { Chart, RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from 'chart.js'
import type { DecadeStats } from '~/types/labs'
import { cssVar } from '~/helpers/theme'
import { RADAR_LABELS, SERIES_TOKENS, radarRawValues, radarValues } from '~/helpers/decadeRadar'

Chart.register(RadarController, RadialLinearScale, PointElement, LineElement, Filler, Tooltip, Legend)

// Draws the selected decades onto `canvas` as an overlaid radar and redraws when the selection changes.
export const useDecadeRadar = (
  canvas: Ref<HTMLCanvasElement | null>,
  decades: Ref<DecadeStats[] | null | undefined>,
  selectedDecades: Ref<string[]>,
) => {
  let chart: Chart | null = null

  // Read live off the theme instead of hard-coded rgba() literals, so a token change doesn't silently drift from the
  // rest of the app. cssVar() reads computed style, which only exists on the client: the chart is drawn on mount.
  const colors = computed(() => SERIES_TOKENS.map((token) => {
    const border = cssVar(`--color-${token}`)
    return { bg: `color-mix(in oklch, ${border} 20%, transparent)`, border }
  }))

  const stone = (percent: number) => `color-mix(in oklch, ${cssVar('--color-stone-100')} ${percent}%, transparent)`

  const render = () => {
    if (!canvas.value || !decades.value || selectedDecades.value.length === 0) {
      chart?.destroy()
      chart = null
      return
    }

    const all = decades.value
    const selected = all.filter(d => selectedDecades.value.includes(d.decade))

    const datasets = selected.map((d, i) => {
      const color = colors.value[i % colors.value.length]!
      return {
        label: d.decade,
        data: radarValues(d, all),
        backgroundColor: color.bg,
        borderColor: color.border,
        borderWidth: 2,
        pointBackgroundColor: color.border,
        pointRadius: 3,
      }
    })

    chart?.destroy()
    chart = new Chart(canvas.value, {
      type: 'radar',
      data: { labels: [...RADAR_LABELS], datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { display: false },
            grid: { color: stone(8) },
            angleLines: { color: stone(8) },
            pointLabels: { color: stone(60), font: { size: 11 } },
          },
        },
        plugins: {
          legend: { position: 'bottom', labels: { color: stone(70), padding: 16 } },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const decade = selected[ctx.datasetIndex]
                return decade ? `${ctx.dataset.label}: ${radarRawValues(decade)[ctx.dataIndex]}` : ''
              },
            },
          },
        },
      },
    })
  }

  watch(selectedDecades, () => nextTick(render), { deep: true })

  onUnmounted(() => {
    chart?.destroy()
  })
}
