<script setup lang="ts">
import { Info } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import { ICON_STROKE_WIDTH } from '~/helpers/ui'

const props = defineProps<{
  release: UnifiedRelease
  trackCount?: number | null
  playCount?: number | null
  alsoPartOfLabel?: string | null
  coArtists?: { name: string, slug: string }[]
  connectedArtistNames?: string[]
}>()

const FEAT_INLINE_LIMIT = 3
const featDialogOpen = ref(false)
const visibleCoArtists = computed(() => props.coArtists?.slice(0, FEAT_INLINE_LIMIT) ?? [])
const hiddenCoArtistCount = computed(() => Math.max(0, (props.coArtists?.length ?? 0) - FEAT_INLINE_LIMIT))

const simpleItems = computed(() => [
  { key: 'type', text: props.release.type, hiddenSm: true },
  { key: 'year', text: props.release.year ? String(props.release.year) : null },
  { key: 'trackCount', text: props.trackCount ? `${props.trackCount} tracks` : null, hiddenSm: true },
  { key: 'discCount', text: props.release.discCount && props.release.discCount > 1 ? `${props.release.discCount} discs` : null },
  { key: 'alsoPartOfLabel', text: props.alsoPartOfLabel ? `Also part of: ${props.alsoPartOfLabel}` : null, hiddenLg: true },
  { key: 'playCount', text: props.playCount ? `${props.playCount.toLocaleString()} plays` : null },
].filter(item => item.text))
</script>

<template>
  <div class="mt-0.5 flex items-center gap-1 text-xs text-stone-100/60">
    <template v-for="(item, i) in simpleItems" :key="item.key">
      <span v-if="i > 0" class="hidden md:inline">&middot;</span>
      <span :class="[item.hiddenSm && 'hidden md:inline', item.hiddenLg && 'hidden truncate lg:inline']">{{ item.text }}</span>
    </template>

    <template v-if="coArtists?.length">
      <span v-if="simpleItems.length" class="hidden md:inline">&middot;</span>
      <span>Feat.
        <template v-for="(co, i) in visibleCoArtists" :key="co.slug">
          <NuxtLink
            :to="`/artist/${co.slug}`"
            class="text-stone-100/60 transition-colors duration-150 hover:text-amber-400"
            @click.stop
          >{{ co.name }}</NuxtLink><template v-if="i < visibleCoArtists.length - 1">, </template>
        </template>
        <template v-if="hiddenCoArtistCount > 0">,
          <button
            type="button"
            class="text-stone-100/60 underline transition-colors duration-150 hover:text-amber-400"
            @click.stop="featDialogOpen = true"
          >View all</button>
        </template>
      </span>
    </template>

    <Dialog v-model="featDialogOpen" title="Featured artists" size="sm">
      <template #content>
        <div class="flex flex-wrap gap-2">
          <NuxtLink
            v-for="co in coArtists"
            :key="co.slug"
            :to="`/artist/${co.slug}`"
            class="rounded-full bg-stone-800 px-3 py-1 text-sm text-stone-100/60 transition-colors duration-150 hover:bg-stone-700 hover:text-amber-400"
            @click.stop="featDialogOpen = false"
          >{{ co.name }}</NuxtLink>
        </div>
      </template>
    </Dialog>

    <template v-if="connectedArtistNames?.length">
      <span v-if="simpleItems.length || coArtists?.length" class="hidden md:inline">&middot;</span>
      <span class="flex items-center gap-1 italic" :title="`Originally credited to: ${connectedArtistNames.join(', ')}`">
        <Info :size="12" :stroke-width="ICON_STROKE_WIDTH" />
        <span>as {{ connectedArtistNames.join(', ') }}</span>
      </span>
    </template>
  </div>
</template>
