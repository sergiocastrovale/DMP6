<script setup lang="ts">
import { Info, Pause, Play } from 'lucide-vue-next'

// The per-row controls in the stat tables. Play only appears when the row is a release - an artist
// row has no single thing to start - so both props are optional and each button is conditional on
// the one it needs.
const props = defineProps<{
  releaseId?: string | null
  artistSlug?: string | null
  label?: string | null
}>()

const { toggleOrPlay, isReleasePlaying } = usePlayRelease()

const playing = computed(() => (props.releaseId ? isReleasePlaying(props.releaseId) : false))
</script>

<template>
  <div class="flex items-center justify-end gap-1">
    <DataTableAction
      v-if="releaseId"
      :icon="playing ? Pause : Play"
      :label="playing ? `Pause ${label ?? 'release'}` : `Play ${label ?? 'release'}`"
      @click.stop="toggleOrPlay(releaseId, artistSlug ?? undefined)"
    />

    <DataTableAction
      v-if="artistSlug"
      :to="`/artist/${artistSlug}`"
      :icon="Info"
      :label="`Go to ${label ?? 'artist'}`"
      @click.stop
    />
  </div>
</template>
