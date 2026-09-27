<script setup lang="ts">
import type { ArtistChooser } from '~/types/artist'
import { grid, typography } from '~/helpers/ui'
import { homonymNote } from '~/helpers/homonyms'

// `/artist/<name>` when several artists share the name (docs/sync_decisions.md "Two artists, one name"): one card per
// artist, each linking to its own `/artist/<name>-<id>` page.
defineProps<{
  chooser: ArtistChooser
}>()

const { artistImage } = useImageUrl()

const releaseCountText = (count: number) => `${count} ${count === 1 ? 'release' : 'releases'}`
</script>

<template>
  <div class="flex flex-col gap-6 p-1 md:px-6 md:py-8">
    <div class="flex flex-col gap-1">
      <h1 :class="typography.h1">
        {{ chooser.name }}
      </h1>
      <p class="text-base text-stone-100/60">
        {{ chooser.homonyms.length }} artists in your library are called {{ chooser.name }}. Pick one.
      </p>
    </div>

    <div :class="grid.auto">
      <Block
        v-for="artist in chooser.homonyms"
        :id="artist.id"
        :key="artist.id"
        :title="artist.name"
        :link="`/artist/${artist.slug}`"
        :image="artistImage(artist)"
      >
        <template #subtitle>
          <span class="flex flex-col truncate">
            <span class="truncate">{{ homonymNote(artist) ?? 'Not yet identified on MusicBrainz' }}</span>
            <span class="text-stone-100/55">{{ releaseCountText(artist.releaseCount) }}</span>
          </span>
        </template>
      </Block>
    </div>
  </div>
</template>
