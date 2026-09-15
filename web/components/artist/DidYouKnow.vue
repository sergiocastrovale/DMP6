<script setup lang="ts">
import { Lightbulb } from 'lucide-vue-next'
import type { ArtistFactResponse } from '~/types/artist'

const props = defineProps<{
  slug: string
}>()

const fact = ref<ArtistFactResponse | null>(null)

// Client-only and fire-and-forget on purpose: Genius may be slow/unconfigured, and this card is
// pure trivia - never worth delaying the rest of the artist page (SSR or otherwise) over.
onMounted(async () => {
  try {
    fact.value = await $fetch<ArtistFactResponse | null>(`/api/artists/${props.slug}/fact`)
  }
  catch {
    fact.value = null
  }
})

const subjectLabel = computed(() => {
  if (fact.value?.track?.title) {return fact.value.track.title}
  if (fact.value?.release?.title) {return fact.value.release.title}
  return null
})
</script>

<template>
  <UiCard v-if="fact" padding="sm" :icon="Lightbulb">
    <template #header>
      <div class="flex size-10 items-center justify-center rounded-lg bg-amber-400/10">
        <Lightbulb :size="20" class="text-amber-400" />
      </div>
      <h2 class="text-lg font-semibold text-stone-100">Did you know...</h2>
    </template>

    <p class="text-sm text-stone-100/75">{{ fact.text }}</p>

    <div v-if="subjectLabel || fact.sourceUrl" class="flex items-center justify-between gap-3 text-xs text-stone-100/45">
      <span v-if="subjectLabel">About "{{ subjectLabel }}"</span>
      <a v-if="fact.sourceUrl" :href="fact.sourceUrl" target="_blank" rel="noopener" class="underline hover:text-stone-100/70">via Genius</a>
    </div>
  </UiCard>
</template>
