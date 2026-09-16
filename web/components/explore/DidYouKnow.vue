<script setup lang="ts">
import { Lightbulb } from 'lucide-vue-next'
import type { ArtistFactResponse } from '~/types/artist'

const props = defineProps<{
  trackId: string
}>()

const fact = ref<ArtistFactResponse | null>(null)

const load = async (trackId: string) => {
  fact.value = null

  try {
    fact.value = await $fetch<ArtistFactResponse | null>(`/api/tracks/${trackId}/fact`)
  }
  catch {
    fact.value = null
  }
}

watch(() => props.trackId, load, { immediate: true })

const subjectLabel = computed(() => {
  if (fact.value?.track?.title) {
    return fact.value.track.title
  }
  
  if (fact.value?.release?.title) {
    return fact.value.release.title
  }
  
  return null
})
</script>

<template>
  <UiCard v-if="fact" padding="sm" :icon="Lightbulb">
    <template #header>
      <div class="flex items-center justify-center gap-2">
        <Lightbulb :size="16" class="text-amber-400" />
        <h2 class="text-lg font-semibold text-amber-400/80">
          {{ subjectLabel ? `About ${subjectLabel}...` : 'Did you know...' }}
        </h2>
      </div>
    </template>

    <div class="text-md pt-2 pl-10 font-display italic text-stone-100/75 tracking-wide">
      <span>"{{ fact.text }}"</span>

      <div class="flex items-center justify-end gap-3 text-sm text-stone-100/45 mt-2">
        <a v-if="fact.sourceUrl" :href="fact.sourceUrl" target="_blank" rel="noopener" class="underline hover:text-stone-100/70">via Genius</a>
      </div>
    </div>
  </UiCard>
</template>
