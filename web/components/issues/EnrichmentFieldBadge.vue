<script setup lang="ts">
import { HelpCircle } from 'lucide-vue-next'
import type { EnrichmentField } from '~/types/issues'

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
    classes: 'bg-accent-soft text-accent border border-accent/50',
    fixable: true,
  },
  bpm: {
    label: 'BPM',
    classes: 'bg-bg-2 text-ink-2',
    fixable: false,
    help: 'BPM data is missing from file tags. Use a tagger with BPM analysis support (beets with the bpm plugin, SongKong, or MusicBrainz Picard with the BPM Analyser plugin).',
  },
  mood: {
    label: 'Mood',
    classes: 'bg-bg-2 text-ink-2',
    fixable: false,
    help: 'Mood analysis tags (MOOD_*) are missing. Use SongKong or beets with the AcousticBrainz plugin to enrich with mood analysis.',
  },
  acousticId: {
    label: 'AcousticID',
    classes: 'bg-bg-2 text-ink-2',
    fixable: false,
    help: 'AcousticID fingerprint is missing. Use MusicBrainz Picard (Lookup CD / fingerprint scan) or the fpcalc CLI to generate fingerprints.',
  },
  discogs: {
    label: 'Discogs',
    classes: 'bg-bg-2 text-ink-2',
    fixable: false,
    help: 'Discogs artist/release URLs are missing. Use SongKong to tag with Discogs identifiers.',
  },
  bandcamp: {
    label: 'Bandcamp',
    classes: 'bg-bg-2 text-ink-2',
    fixable: false,
    help: 'Bandcamp URL is missing from file tags. Use SongKong to add Bandcamp links where available.',
  },
  wikipedia: {
    label: 'Wikipedia',
    classes: 'bg-bg-2 text-ink-2',
    fixable: false,
    help: 'Wikipedia URL is missing from file tags. Use SongKong to add Wikipedia links where available.',
  },
}

const cfg = computed(() => CONFIG[props.field])
</script>

<template>
  <span class="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium" :class="cfg.classes">
    {{ cfg.label }}
    <Popover v-if="!cfg.fixable" trigger="hover">
      <template #trigger>
        <HelpCircle :size="11" class="opacity-60 hover:opacity-100" />
      </template>
      <template #content>
        <div class="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
          <p class="text-xs text-ink-2">{{ cfg.help }}</p>
        </div>
      </template>
    </Popover>
  </span>
</template>
