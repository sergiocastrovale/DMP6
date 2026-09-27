<script setup lang="ts">
import { UserRoundCheck } from 'lucide-vue-next'
import type { ArtistHomonym } from '~/types/artist'
import { homonymNote } from '~/helpers/homonyms'

// In the release info dialog when other artists share this artist's name: "this release is really theirs". Writes that
// artist's MusicBrainz id into the release's files and re-indexes them (./fix --assign-artist) - the files stay the
// source of truth (docs/sync_decisions.md "Two artists, one name"). Only identified artists can be picked: there is no
// id to write for one that is not.
const props = defineProps<{
  artistName: string
  homonyms: ArtistHomonym[]
}>()

const emit = defineEmits<{
  assign: [mbid: string]
}>()

const candidates = computed(() => props.homonyms.filter(h => !!h.musicbrainzId))
</script>

<template>
  <div v-if="candidates.length" class="flex flex-col gap-2 border-t border-stone-100/10 pt-4">
    <p class="text-sm text-stone-100/60">
      By a different {{ artistName }}? Move it - its files are re-tagged and re-indexed.
    </p>
    <div class="flex flex-wrap gap-2">
      <UiButton
        v-for="other in candidates"
        :key="other.id"
        variant="secondary"
        size="sm"
        :icon="UserRoundCheck"
        @click="emit('assign', other.musicbrainzId!)"
      >
        {{ homonymNote(other) ?? other.slug }}
      </UiButton>
    </div>
  </div>
</template>
