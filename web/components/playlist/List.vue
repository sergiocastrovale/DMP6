<script setup lang="ts">
import { LucideListMusic, LucideSparkles, LucideGlobe } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import type { Component } from 'vue'

const props = defineProps<{
  playlists: PlaylistSummary[]
}>()

const emit = defineEmits<{
  create: []
}>()

const { hasPerm } = useAuth()
const canCrud = hasPerm('playlists.crud')

const hasGenerated = computed(() => props.playlists.some(p => p.type !== 'MANUAL'))

interface PlaylistSection {
  type: PlaylistSummary['type']
  label: string
  icon: Component
  popoverTitle?: string
  popoverText?: string
  items: ComputedRef<PlaylistSummary[]>
}

const sections: PlaylistSection[] = [
  {
    type: 'MANUAL',
    label: 'Your Playlists',
    icon: LucideListMusic,
    items: computed(() => props.playlists.filter(p => p.type === 'MANUAL')),
  },
  {
    type: 'GENRE',
    label: 'Genre Playlists',
    icon: LucideSparkles,
    popoverTitle: 'How genre playlists work',
    popoverText: 'Each playlist groups related genres under a single theme. Tracks are pulled from your library based on MusicBrainz genre tags and update whenever you run Regenerate.',
    items: computed(() => props.playlists.filter(p => p.type === 'GENRE')),
  },
  {
    type: 'REGION',
    label: 'Region Playlists',
    icon: LucideGlobe,
    popoverTitle: 'How region playlists work',
    popoverText: 'Each playlist groups artists by their country of origin as listed in MusicBrainz. Tracks update whenever you run Regenerate.',
    items: computed(() => props.playlists.filter(p => p.type === 'REGION')),
  },
]
</script>

<template>
  <template v-for="section in sections" :key="section.type">
    <div v-if="section.items.value.length > 0" class="flex flex-col gap-4">
      <div class="flex items-center gap-2">
        <component :is="section.icon" v-if="section.type !== 'MANUAL'" class="size-4 text-accent" />
        <h2
          v-if="section.type !== 'MANUAL' || hasGenerated"
          class="text-lg font-semibold text-ink"
        >
          {{ section.label }}
        </h2>
        <span v-if="section.type !== 'MANUAL'" class="text-xs text-ink0">Auto-generated</span>
        <PlaylistGeneratedPopover
          v-if="section.popoverTitle"
          :title="section.popoverTitle"
          :text="section.popoverText!"
        />
      </div>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <PlaylistBlock
          v-for="playlist in section.items.value"
          :key="playlist.id"
          :playlist="playlist"
        />
      </div>
    </div>
  </template>

  <div
    v-if="playlists.length === 0"
    class="flex flex-col items-center justify-center py-20 text-center text-ink0"
  >
    <LucideListMusic class="mb-3 size-12 opacity-50" />
    <p>No playlists yet</p>
    <button
      v-if="canCrud"
      class="mt-4 text-sm text-accent hover:text-accent transition-colors"
      @click="emit('create')"
    >
      Create your first playlist
    </button>
  </div>
</template>
