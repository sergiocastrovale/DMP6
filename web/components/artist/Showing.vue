<script setup lang="ts">
import type { useArtistCatalogue } from '~/composables/useArtistCatalogue'
import { statuses } from '~/helpers/constants'

const catalogue = inject<ReturnType<typeof useArtistCatalogue>>('catalogue')!

// "In catalogue" = owned locally, i.e. everything except MISSING (MB release with no local
// files at all) - MISSING itself isn't part of the catalogue so it's excluded from this line.
const statusLine = computed(() => {
  const counts = catalogue.totalStatusCounts.value
  const owned = Object.entries(counts)
    .filter(([status]) => status !== 'MISSING')
    .reduce((sum, [, c]) => sum + c, 0)

  if (!owned) {
    return ''
  }

  const parts = [`${owned} in catalogue`]
  for (const s of statuses) {
    if (s.value === 'MISSING') {
      continue
    }
    const count = counts[s.value] ?? 0
    if (count) {
      parts.push(`${count} ${s.label.toLowerCase()}`)
    }
  }

  return parts.join(' · ')
})

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
  <div v-if="statsLine || statusLine" class="flex flex-col text-base text-stone-100/60">
    <div v-if="statsLine">{{ statsLine }}</div>
    <div v-if="statusLine">{{ statusLine }}</div>
  </div>
</template>