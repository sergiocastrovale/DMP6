<script setup lang="ts">
import { CircleHelp } from 'lucide-vue-next'
import type { EnrichmentField } from '~/types/issues'
import { surface, toneBg } from '~/helpers/ui'

const props = defineProps<{ field: EnrichmentField }>()

type FieldConfig = {
  label: string
  classes: string
  fixable: boolean
  help?: string
}

const CONFIG: Record<EnrichmentField, FieldConfig> = {
  mbRelease: {
    label: 'MB unlinked',
    classes: `${toneBg.accent} border border-amber-400/40`,
    fixable: true,
  },
  bpm: {
    label: 'BPM',
    classes: toneBg.muted,
    fixable: false,
    help: 'BPM data is missing from file tags. Use a tagger with BPM analysis support (beets with the bpm plugin, SongKong, or MusicBrainz Picard with the BPM Analyser plugin).',
  },
  mood: {
    label: 'Mood',
    classes: toneBg.muted,
    fixable: false,
    help: 'Mood analysis tags (MOOD_*) are missing. Use SongKong or beets with the AcousticBrainz plugin to enrich with mood analysis.',
  },
  acousticId: {
    label: 'AcousticID',
    classes: toneBg.muted,
    fixable: false,
    help: 'AcousticID fingerprint is missing. Use MusicBrainz Picard (Lookup CD / fingerprint scan) or the fpcalc CLI to generate fingerprints.',
  },
  discogs: {
    label: 'Discogs',
    classes: toneBg.muted,
    fixable: false,
    help: 'Discogs artist/release URLs are missing. Use SongKong to tag with Discogs identifiers.',
  },
  bandcamp: {
    label: 'Bandcamp',
    classes: toneBg.muted,
    fixable: false,
    help: 'Bandcamp URL is missing from file tags. Use SongKong to add Bandcamp links where available.',
  },
  wikipedia: {
    label: 'Wikipedia',
    classes: toneBg.muted,
    fixable: false,
    help: 'Wikipedia URL is missing from file tags. Use SongKong to add Wikipedia links where available.',
  },
}

const cfg = computed(() => CONFIG[props.field])
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" :class="cfg.classes">
    {{ cfg.label }}
    <Popover v-if="!cfg.fixable" trigger="hover">
      <template #trigger>
        <button type="button" :aria-label="`Why is ${cfg.label} missing?`" class="opacity-60 hover:opacity-100">
          <CircleHelp :size="11" />
        </button>
      </template>
      <template #content>
        <div :class="[surface.popover, 'absolute left-0 top-full z-20 mt-1 w-64 p-3']">
          <p class="text-sm text-stone-100/60">{{ cfg.help }}</p>
        </div>
      </template>
    </Popover>
  </span>
</template>
