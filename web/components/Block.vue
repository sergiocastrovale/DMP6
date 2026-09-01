<script setup lang="ts">
import { cx } from '~/helpers/ui'

const props = withDefaults(defineProps<{
  id: string
  title?: string
  titleLink?: string
  subtitle?: string
  subtitleLink?: string
  link?: string
  year?: number | null
  genre?: string | null
  score?: number | null
  image?: string | null
  playable?: boolean
  releaseId?: string
  artistSlug?: string
}>(), {
  title: undefined,
  titleLink: undefined,
  subtitle: undefined,
  subtitleLink: undefined,
  link: undefined,
  year: undefined,
  genre: undefined,
  score: undefined,
  image: undefined,
  playable: false,
  releaseId: undefined,
  artistSlug: undefined,
})

const { toggleOrPlay, isReleasePlaying } = usePlayRelease()

const isPlaying = computed(() => props.releaseId ? isReleasePlaying(props.releaseId) : false)

const handlePlay = (e: Event) => {
  e.stopPropagation()
  e.preventDefault()
  if (props.releaseId) {
    toggleOrPlay(props.releaseId, props.artistSlug)
  }
}

const hasMetadata = computed(() => props.year || props.genre || (props.score !== undefined && props.score !== null))

const nameClass = 'font-display font-semibold text-lg text-stone-100 truncate'
const subClass = 'text-sm text-stone-100/55 truncate'
const metaClass = 'flex items-center gap-2 font-mono text-2xs uppercase text-stone-100/50'
</script>

<template>
  <NuxtLink v-if="link" :to="link" class="cursor-pointer flex flex-col gap-3 group">
    <UiThumb>
      <img
        v-if="image"
        :src="image"
        :alt="title"
        loading="lazy"
        class="w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.04]"
      >
      <slot name="overlay" />
    </UiThumb>
    <div class="flex flex-col gap-0.5 min-w-0">
      <div v-if="title" :class="nameClass">
        {{ title }}
      </div>
      <div v-if="subtitle" :class="subClass">
        {{ subtitle }}
      </div>
      <div v-if="hasMetadata" :class="metaClass">
        <span v-if="year" class="shrink-0">{{ year }}</span>
        <Bullet v-if="year && genre" />
        <span v-if="genre" class="truncate min-w-0">{{ genre }}</span>
        <ArtistAverageMatchScore v-if="score !== undefined && score !== null" :score="score" />
      </div>
    </div>
  </NuxtLink>

  <article v-else class="cursor-pointer flex flex-col gap-3 group">
    <UiThumb @click="playable ? handlePlay($event) : undefined">
      <img
        v-if="image"
        :src="image"
        :alt="title"
        loading="lazy"
        class="w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.04]"
      >
      <slot name="overlay" />
      <PlayerPlayPauseButton
        v-if="playable && releaseId"
        :playing="isPlaying"
        class="absolute right-3 bottom-3 bg-amber-400 text-on-accent shadow-md transition-all duration-200"
        :class="isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'"
      />
    </UiThumb>
    <div class="flex flex-col gap-0.5 min-w-0">
      <NuxtLink
        v-if="title && titleLink"
        :to="titleLink"
        :class="cx(nameClass, 'hover:text-amber-400 transition-colors duration-150')"
      >
        {{ title }}
      </NuxtLink>
      <div v-else-if="title" :class="nameClass">
        {{ title }}
      </div>
      <NuxtLink
        v-if="subtitle && subtitleLink"
        :to="subtitleLink"
        :class="cx(subClass, 'hover:text-stone-100 transition-colors duration-150')"
        @click.stop
      >
        {{ subtitle }}
      </NuxtLink>
      <div v-else-if="subtitle" :class="subClass">
        {{ subtitle }}
      </div>
      <div v-if="hasMetadata" :class="metaClass">
        <span v-if="year" class="shrink-0">{{ year }}</span>
        <Bullet v-if="year && genre" />
        <span v-if="genre" class="truncate min-w-0">{{ genre }}</span>
        <ArtistAverageMatchScore v-if="score !== undefined && score !== null" :score="score" />
      </div>
    </div>
  </article>
</template>
