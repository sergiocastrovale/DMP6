<script setup lang="ts">
import { CircleHelp } from 'lucide-vue-next'
import type { EnrichmentField, EnrichmentFieldConfig } from '~/types/issues'
import { surface } from '~/helpers/ui'

const props = defineProps<{ field: EnrichmentField }>()

const CONFIG: Record<EnrichmentField, EnrichmentFieldConfig> = {
  mbRelease: {
    label: 'MB unlinked',
    tone: 'accent',
    extraClass: 'border border-amber-400/40',
    fixable: true,
  },
  bpm: {
    label: 'BPM',
    tone: 'muted',
    fixable: false,
    help: 'BPM data is missing from file tags. Use a tagger with BPM analysis support (beets with the bpm plugin, SongKong, or MusicBrainz Picard with the BPM Analyser plugin).',
  },
  mood: {
    label: 'Mood',
    tone: 'muted',
    fixable: false,
    help: 'Mood analysis tags (MOOD_*) are missing. Use SongKong or beets with the AcousticBrainz plugin to enrich with mood analysis.',
  },
  acousticId: {
    label: 'AcousticID',
    tone: 'muted',
    fixable: false,
    help: 'AcousticID fingerprint is missing. Use MusicBrainz Picard (Lookup CD / fingerprint scan) or the fpcalc CLI to generate fingerprints.',
  },
  discogs: {
    label: 'Discogs',
    tone: 'muted',
    fixable: false,
    help: 'Discogs artist/release URLs are missing. Use SongKong to tag with Discogs identifiers.',
  },
  bandcamp: {
    label: 'Bandcamp',
    tone: 'muted',
    fixable: false,
    help: 'Bandcamp URL is missing from file tags. Use SongKong to add Bandcamp links where available.',
  },
  wikipedia: {
    label: 'Wikipedia',
    tone: 'muted',
    fixable: false,
    help: 'Wikipedia URL is missing from file tags. Use SongKong to add Wikipedia links where available.',
  },
}

const cfg = computed(() => CONFIG[props.field])
</script>

<template>
  <UiBadge :tone="cfg.tone" :class="cfg.extraClass">
    {{ cfg.label }}
    <Popover v-if="!cfg.fixable" trigger="hover" teleport>
      <template #trigger>
        <button type="button" :aria-label="`Why is ${cfg.label} missing?`" class="opacity-60 hover:opacity-100">
          <CircleHelp :size="11" />
        </button>
      </template>
      <template #content>
        <div :class="[surface.popover, 'w-64 p-3']">
          <p class="text-sm text-stone-100/60">{{ cfg.help }}</p>
        </div>
      </template>
    </Popover>
  </UiBadge>
</template>
