<script setup lang="ts">
import { LucideMusic } from 'lucide-vue-next'
import type { TrackInContext } from '~/types/common'
import { formatDuration } from '~/helpers/functions'

defineProps<{
  track: TrackInContext
  playing: boolean
  current: boolean
}>()

defineEmits<{ click: [] }>()

defineSlots<{ action?: () => any }>()

const { releaseImage } = useImageUrl()
</script>

<template>
  <SlimTableRow :active="current" @click="$emit('click')">
    <td class="w-14 py-2 pl-4">
      <UiThumb size="sm" class="group/cover">
        <img
          v-if="track.release && releaseImage(track.release)"
          :src="releaseImage(track.release)!"
          :alt="track.title"
          class="h-full w-full object-cover"
        >
        <div v-else class="flex h-full w-full items-center justify-center text-stone-100/20">
          <LucideMusic class="size-5" />
        </div>
        <div
          class="absolute inset-0 flex items-center justify-center bg-black/30 transition-colors duration-150 group-hover/cover:bg-black/60"
        >
          <PlayerPlayPauseButton
            :playing="playing"
            size="sm"
            class="group-hover/cover:bg-amber-400 group-hover/cover:text-on-accent group-hover/cover:scale-105"
            :class="current ? 'text-amber-400' : 'text-white/50 group-hover/cover:text-white'"
          />
        </div>
      </UiThumb>
    </td>
    <td class="py-2 pl-3">
      <p
        class="truncate text-base font-medium"
        :class="current ? 'text-amber-400' : 'text-stone-100'"
      >
        {{ track.title }}
      </p>
      <div v-if="track.release" class="flex items-center gap-1.5 text-sm text-stone-100/55">
        <NuxtLink
          v-if="track.release.artist"
          :to="`/artist/${track.release.artist.slug}`"
          class="truncate hover:text-stone-100 transition-colors duration-150"
          @click.stop
        >
          {{ track.release.artist.name }}
        </NuxtLink>
        <Bullet v-if="track.release.artist" />
        <span class="truncate">{{ track.release.title }}</span>
      </div>
    </td>
    <td class="w-16 py-2 pr-4 text-center tabular-nums text-sm text-stone-100/55">
      {{ formatDuration(track.duration) }}
    </td>
    <td v-if="$slots.action" class="w-12 py-2 pr-4 text-center">
      <slot name="action" />
    </td>
  </SlimTableRow>
</template>
