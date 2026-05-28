<script setup lang="ts">

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
</script>

<template>
  <NuxtLink v-if="link" :to="link" class="cursor-pointer flex flex-col gap-3 group">
    <div class="aspect-square relative overflow-hidden rounded-cover bg-bg-2">
      <img
        v-if="image"
        :src="image"
        :alt="title"
        loading="lazy"
        class="w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.04]"
      />
      <slot name="overlay" />
    </div>
    <div class="flex flex-col gap-0.5 min-w-0">
      <div v-if="title" class="font-display font-semibold text-card-title text-ink truncate">
        {{ title }}
      </div>
      <div v-if="subtitle" class="text-card-artist text-ink-2 truncate">
        {{ subtitle }}
      </div>
      <div v-if="hasMetadata" class="flex items-center gap-2 font-mono text-sm text-meta uppercase text-ink-4">
        <span v-if="year" class="shrink-0">{{ year }}</span>
        <Bullet v-if="year && genre" />
        <span v-if="genre" class="truncate min-w-0">{{ genre }}</span>
        <ArtistAverageMatchScore v-if="score !== undefined && score !== null" :score="score" />
      </div>
    </div>
  </NuxtLink>

  <article v-else class="cursor-pointer flex flex-col gap-3 group">
    <div class="aspect-square relative overflow-hidden rounded-cover bg-bg-2" @click="playable ? handlePlay($event) : undefined">
      <img
        v-if="image"
        :src="image"
        :alt="title"
        loading="lazy"
        class="w-full h-full object-cover transition-transform duration-400 group-hover:scale-[1.04]"
      />
      <slot name="overlay" />
      <PlayerPlayPauseButton
        v-if="playable && releaseId"
        :playing="isPlaying"
        class="absolute right-3 bottom-3 bg-accent text-accent-ink shadow-play transition-all duration-200"
        :class="isPlaying ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0'"
      />
    </div>
    <div class="flex flex-col gap-0.5 min-w-0">
      <NuxtLink
        v-if="title && titleLink"
        :to="titleLink"
        class="font-display font-semibold text-card-title text-ink truncate hover:text-accent transition-colors"
      >
        {{ title }}
      </NuxtLink>
      <div v-else-if="title" class="font-display font-semibold text-card-title text-ink truncate">
        {{ title }}
      </div>
      <NuxtLink
        v-if="subtitle && subtitleLink"
        :to="subtitleLink"
        class="text-card-artist text-ink-2 truncate hover:text-ink transition-colors"
        @click.stop
      >
        {{ subtitle }}
      </NuxtLink>
      <div v-else-if="subtitle" class="text-card-artist text-ink-2 truncate">
        {{ subtitle }}
      </div>
      <div v-if="hasMetadata" class="flex items-center gap-2 font-mono text-sm text-meta uppercase text-ink-4">
        <span v-if="year" class="shrink-0">{{ year }}</span>
        <Bullet v-if="year && genre" />
        <span v-if="genre" class="truncate min-w-0">{{ genre }}</span>
        <ArtistAverageMatchScore v-if="score !== undefined && score !== null" :score="score" />
      </div>
    </div>
  </article>
</template>
