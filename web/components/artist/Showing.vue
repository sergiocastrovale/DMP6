<script setup lang="ts">
import type { useArtistCatalogue } from '~/composables/useArtistCatalogue'

const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!

const statsLine = computed(() => {
  const v = catalogue.visibleCounts.value
  const t = catalogue.totalCounts.value
  const parts: string[] = []
  
  parts.push(`Showing ${v.total} of ${t.total} releases`)

  if (v.albums) {
    parts.push(`${v.albums} ${v.albums === 1 ? 'album' : 'albums'}`)
  }

  if (v.eps) {
    parts.push(`${v.eps} ${v.eps === 1 ? 'EP' : 'EPs'}`)
  }

  if (v.singles) {
    parts.push(`${v.singles} ${v.singles === 1 ? 'single' : 'singles'}`)
  }

  return parts.join(' · ')
})

</script>

<template>
  <div v-if="statsLine" class="text-base text-stone-100/60">
    {{ statsLine }}
  </div>
</template> 