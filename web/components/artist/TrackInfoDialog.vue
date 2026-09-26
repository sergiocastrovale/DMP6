<script setup lang="ts">
import type { Track, TrackInfo } from '~/types/track'
import { trackInfoRows } from '~/helpers/trackInfo'

const open = defineModel<boolean>({ required: true })

const props = defineProps<{
  track: Track | null
  info: TrackInfo | null
}>()

const rows = computed(() => props.track ? trackInfoRows(props.track, props.info) : [])
</script>

<template>
  <Dialog v-model="open" :title="track?.title ?? 'Track Info'" size="md">
    <template v-if="track" #content>
      <dl class="space-y-3 text-sm">
        <div v-for="row in rows" :key="row.label">
          <dt class="text-xs text-stone-100/60">{{ row.label }}</dt>
          <dd class="font-mono text-xs text-stone-100/60" :class="row.breakAll && 'break-all'">{{ row.value }}</dd>
        </div>
      </dl>
    </template>
  </Dialog>
</template>
