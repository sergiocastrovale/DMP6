<script setup lang="ts">
import { linkIcons } from '~/helpers/constants'
import type { ArtistUrl } from '~/types/artist'

const props = defineProps<{
  links: ArtistUrl[]
}>()

const links = computed<ArtistUrl[]>(() =>
  props.links.filter(u => u.type.toLowerCase() in linkIcons),
)
const unidentifiedLinks = computed<ArtistUrl[]>(() =>
  props.links.filter(u => !(u.type.toLowerCase() in linkIcons)),
)
const hasMoreLinks = computed(() => unidentifiedLinks.value.length > 0)

const getIcon = (type: string) => {
  return linkIcons[type.toLowerCase()] || null
}

const emit = defineEmits<{
  'more': []
}>()
</script>

<template>
  <div v-if="links.length" class="flex flex-wrap items-center gap-1.5 mt-1">
    <a
      v-for="link in links"
      :key="link.id"
      :href="link.url"
      target="_blank"
      rel="noopener"
      :title="link.type"
      class="flex items-center justify-center size-8 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-50 transition-colors"
    >
      <svg
        v-if="getIcon(link.type)"
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        :viewBox="getIcon(link.type)!.viewBox"
        fill="currentColor"
        class="shrink-0"
      >
        <path :d="getIcon(link.type)!.path" />
      </svg>
    </a>
    <button
      v-if="hasMoreLinks"
      class="flex items-center justify-center size-8 rounded bg-zinc-800 text-xs text-amber-500 hover:bg-zinc-700 transition-colors"
      title="View all links"
      @click="emit('more')"
    >
      +{{ unidentifiedLinks.length }}
    </button>
  </div>
</template>