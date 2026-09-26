<script setup lang="ts">
import type { MapCountry } from '~/types/labs'

useTitle('Labs', 'World Map')

definePageMeta({ layout: false })

const { data: countryData, status } = useFetch<Record<string, MapCountry>>('/api/labs/map/countries')

const mapContainer = ref<HTMLElement | null>(null)

const dialog = useCountryDialog(countryData)
const { tooltip, ready, setTexture } = useLeafletMap(mapContainer, { onCountryClick: dialog.openCountry })
const { generating, progress, progressPercent } = useMapTextures(countryData, ready, setTexture)
const { exporting, downloadPng } = useMapExport(mapContainer)

const coverageStat = computed(() => {
  const entries = Object.values(countryData.value ?? {})
  return { countries: entries.length, artists: entries.reduce((sum, c) => sum + c.count, 0) }
})

const tooltipData = computed(() => {
  if (!tooltip.value || !countryData.value) {
    return null
  }
  const entry = countryData.value[tooltip.value.code]
  return entry ? { name: entry.name, count: entry.count } : { name: tooltip.value.code, count: 0 }
})
</script>

<template>
  <div class="flex h-screen flex-col bg-stone-950 font-sans text-stone-100 antialiased">
    <div class="px-4 py-3">
      <LabsBackLink />
    </div>

    <div class="relative flex-1">
      <div ref="mapContainer" class="absolute inset-0" />

      <div
        v-if="status === 'pending'"
        class="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div class="text-base text-stone-100/60">Loading map data...</div>
      </div>

      <LabsMapProgress v-if="generating" :current="progress.current" :total="progress.total" :percent="progressPercent" />

      <LabsMapCoverage
        v-if="coverageStat.countries > 0"
        :artists="coverageStat.artists"
        :countries="coverageStat.countries"
        :exporting="exporting"
        @download="downloadPng"
      />
    </div>

    <PlayerAudioPlayer />

    <LabsMapTooltip v-if="tooltip && tooltipData" :x="tooltip.x" :y="tooltip.y" :name="tooltipData.name" :count="tooltipData.count" />

    <LabsMapCountryDialog
      v-model="dialog.open.value"
      :title="dialog.country.value ? `${dialog.country.value.name} (${dialog.country.value.count})` : ''"
      :artists="dialog.artists.value"
      :loading="dialog.loading.value"
      @load-more="dialog.loadMore"
    />
  </div>
</template>
