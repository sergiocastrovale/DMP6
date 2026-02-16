<script setup lang="ts">
import { Play } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import { usePlayerStore } from '~/stores/player'

const props = defineProps<{
  releases: UnifiedRelease[]
}>()

const player = usePlayerStore()

// Get unique types for tabs
const types = computed(() => {
  const typeMap = new Map<string, { name: string; slug: string; count: number }>()
  for (const r of props.releases) {
    const existing = typeMap.get(r.typeSlug)
    if (existing) {
      existing.count++
    }
    else {
      typeMap.set(r.typeSlug, { name: r.type, slug: r.typeSlug, count: 1 })
    }
  }
  return Array.from(typeMap.values())
})

const activeTab = ref(types.value[0]?.slug || '')

watch(types, (newTypes) => {
  if (newTypes.length && !newTypes.find(t => t.slug === activeTab.value)) {
    activeTab.value = newTypes[0].slug
  }
}, { immediate: true })

const filteredReleases = computed(() => {
  return props.releases.filter(r => r.typeSlug === activeTab.value)
})

const expandedRelease = ref<string | null>(null)

function toggleExpand(id: string) {
  expandedRelease.value = expandedRelease.value === id ? null : id
}

async function playRelease(release: UnifiedRelease) {
  const releaseId = release.localReleaseId || release.id
  try {
    const data = await $fetch<any>(`/api/releases/${releaseId}/tracks`)
    if (data?.tracks?.length) {
      const playerTracks = data.tracks.map((t: any) => ({
        id: t.id,
        title: t.title || 'Unknown',
        artist: t.artist || 'Unknown',
        album: t.album || release.title,
        duration: t.duration || 0,
        artistSlug: data.release?.artistSlug || null,
        releaseImage: data.release?.image ? `/img/releases/${data.release.image}` : null,
        releaseImageUrl: data.release?.imageUrl || null,
        localReleaseId: t.localReleaseId,
      }))
      player.setQueue(playerTracks)
    }
  }
  catch { /* ignore */ }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- Type tabs -->
    <div v-if="types.length > 1" class="flex flex-wrap gap-1 border-b border-zinc-800 pb-2">
      <button
        v-for="type in types"
        :key="type.slug"
        class="rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
        :class="
          activeTab === type.slug
            ? 'bg-zinc-800 text-amber-500'
            : 'text-zinc-400 hover:text-zinc-50'
        "
        @click="activeTab = type.slug"
      >
        {{ type.name }}
        <span class="ml-1 text-xs text-zinc-500">{{ type.count }}</span>
      </button>
    </div>

    <!-- Release list -->
    <div class="flex flex-col gap-3">
      <div
        v-for="release in filteredReleases"
        :key="release.id"
        class="rounded-lg border border-zinc-800 bg-zinc-900/50 transition-colors hover:border-zinc-700"
      >
        <!-- Release row -->
        <div
          class="flex cursor-pointer items-center gap-4 p-3"
          @click="toggleExpand(release.id)"
        >
          <ReleaseReleaseCover
            :image="release.image"
            :image-url="release.imageUrl"
            :title="release.title"
            size="sm"
            @play.stop="playRelease(release)"
          />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <p class="truncate text-sm font-medium text-zinc-50">{{ release.title }}</p>
              <ReleaseStatusBadge
                :status="release.status"
                :track-count="release.trackCount"
                :local-track-count="release.localTrackCount"
              />
            </div>
            <div class="flex items-center gap-3 text-xs text-zinc-400">
              <span v-if="release.year">{{ release.year }}</span>
              <span v-if="release.trackCount">{{ release.trackCount }} tracks</span>
              <span v-if="release.localTrackCount && release.trackCount !== release.localTrackCount">
                {{ release.localTrackCount }} local
              </span>
            </div>
          </div>
          <button
            v-if="release.localReleaseId || release.localTrackCount > 0"
            class="shrink-0 rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50 transition-colors"
            @click.stop="playRelease(release)"
          >
            <Play :size="16" />
          </button>
        </div>

        <!-- Expanded tracks table -->
        <div v-if="expandedRelease === release.id && (release.localReleaseId || release.localTrackCount > 0)" class="border-t border-zinc-800 px-3 pb-3">
          <ReleaseTracksTable :release-id="release.localReleaseId || release.id" />
        </div>
      </div>
    </div>

    <!-- Empty tab -->
    <div v-if="filteredReleases.length === 0" class="py-8 text-center text-sm text-zinc-500">
      No releases in this category
    </div>
  </div>
</template>
