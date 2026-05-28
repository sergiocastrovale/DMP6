<script setup lang="ts">
import { ChevronDown, ChevronRight, Disc3 } from 'lucide-vue-next'
import type { ReleaseGroup } from '~/types/release'

const props = defineProps<{
  group: ReleaseGroup
  expanded: boolean
  slug: string
}>()

const emit = defineEmits<{
  toggle: []
  play: []
}>()

const { releaseImage } = useImageUrl()
const { isCurrentRelease: isCurrentReleaseId, isReleasePlaying: isReleasePlayingId } = usePlayRelease()

const getReleaseId = (r: typeof props.group.primary) => r.localReleaseId || r.id

const isGroupCurrent = computed(() => props.group.releases.some(r => isCurrentReleaseId(getReleaseId(r))))
const isGroupPlaying = computed(() => props.group.releases.some(r => isReleasePlayingId(getReleaseId(r))))
const hasPlayable = computed(() => props.group.releases.some(r => r.localReleaseId || r.localTrackCount > 0))
</script>

<template>
  <div
    :data-group-key="group.key"
    class="border-b border-rule transition-colors last:border-b-0"
    :class="group.primary.status === 'MISSING' ? '' : 'hover:bg-bg-2/50'"
  >
    <div class="group flex cursor-pointer items-center gap-3 p-3" @click="emit('toggle')">
      <button
        type="button"
        class="flex size-5 items-center justify-center text-ink0"
        @click.stop="emit('toggle')"
      >
        <ChevronDown v-if="expanded" :size="14" />
        <ChevronRight v-else :size="14" />
      </button>

      <div
        class="group/cover relative size-15 shrink-0 cursor-pointer bg-bg-2"
        @click.stop="hasPlayable && emit('play')"
      >
        <img
          v-if="releaseImage(group.primary)"
          :src="releaseImage(group.primary)!"
          :alt="group.primary.title"
          class="size-full object-cover"
          loading="lazy"
        />
        <div v-else class="flex size-full items-center justify-center text-ink-4">
          <Disc3 :size="24" />
        </div>
        <div
          v-if="hasPlayable"
          class="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors group-hover/cover:bg-black/60"
        >
          <PlayerPlayPauseButton
            :playing="isGroupPlaying"
            size="sm"
            class="group-hover/cover:bg-accent group-hover/cover:text-accent-ink group-hover/cover:scale-105"
            :class="isGroupPlaying || isGroupCurrent ? 'text-accent' : 'text-white/50 group-hover/cover:text-white'"
          />
        </div>
      </div>

      <div class="min-w-0 flex-1 ml-1">
        <div class="flex items-baseline gap-2 text-sm">
          <span class="truncate text-lg font-medium" :class="group.primary.status === 'MISSING' ? 'text-ink0' : 'text-ink'">
            {{ group.primary.title }}
          </span>
          <span
            v-if="group.releases.length > 1"
            class="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent"
          >{{ group.releases.length }} editions</span>
        </div>
        <div class="mt-0.5 flex items-center gap-3 text-xs" :class="group.primary.status === 'MISSING' ? 'text-ink-4' : 'text-ink-2'">
          <span v-if="group.primary.type">{{ group.primary.type }}</span>
          <span v-if="group.primary.year">· {{ group.primary.year }}</span>
          <span v-if="group.totalTracks">· {{ group.totalTracks }} tracks</span>
          <span v-if="group.primary.coArtists?.length" class="text-ink0">Feat.
            <template v-for="(co, i) in group.primary.coArtists" :key="co.slug">
              <NuxtLink
                :to="`/artist/${co.slug}`"
                class="text-ink-2 transition-colors hover:text-accent"
                @click.stop
              >{{ co.name }}</NuxtLink><template v-if="i < group.primary.coArtists!.length - 1">, </template>
            </template>
          </span>
          <span v-if="group.totalPlayCount">· {{ group.totalPlayCount.toLocaleString() }} plays</span>
        </div>
      </div>

      <ReleaseStatusMulti :releases="group.releases" />
    </div>

    <div v-if="expanded" @click.stop>
      <div class="ml-8 border-l-2 border-rule">
        <slot />
      </div>
    </div>
  </div>
</template>
