<script setup lang="ts">
import { LucideListMusic, LucideSparkles, LucideGlobe } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import type { Component } from 'vue'
import { typography, toneBg, grid } from '~/helpers/ui'

const props = defineProps<{
  playlists: PlaylistSummary[]
}>()

const emit = defineEmits<{
  create: []
}>()

const { hasPerm } = useAuth()
const canCrud = hasPerm('playlists.crud')

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
  <div class="flex flex-col gap-10">
    <template v-for="section in sections" :key="section.type">
      <div v-if="section.items.value.length > 0" class="flex flex-col gap-4">
        <div class="flex items-center gap-2.5">
          <h2 :class="typography.h3">{{ section.label }}</h2>
          <span
            v-if="section.type !== 'MANUAL'"
            :class="[toneBg.accent, 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium']"
          >
            <component :is="section.icon" class="size-3" />
            Auto-generated
          </span>
          <PlaylistGeneratedPopover
            v-if="section.popoverTitle"
            :title="section.popoverTitle"
            :text="section.popoverText!"
          />
        </div>
        <div :class="grid.auto">
          <PlaylistBlock
            v-for="playlist in section.items.value"
            :key="playlist.id"
            :playlist="playlist"
          />
        </div>
      </div>
    </template>

    <UiEmptyState v-if="playlists.length === 0" :icon="LucideListMusic" message="No playlists yet">
      <template v-if="canCrud" #action>
        <UiButton variant="secondary" size="sm" @click="emit('create')">
          Create your first playlist
        </UiButton>
      </template>
    </UiEmptyState>
  </div>
</template>
