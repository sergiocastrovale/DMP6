<script setup lang="ts">
import { linkIcons } from '~/helpers/constants'
import type { ArtistUrl } from '~/types/artist'

const props = defineProps<{
  links: ArtistUrl[]
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

function getIcon(type: string) {
  return linkIcons[type.toLowerCase()] || null
}
</script>

<template>
  <Dialog :model-value="modelValue" title="All Links" @update:model-value="emit('update:modelValue', $event)">
  <div class="flex flex-col gap-1">
    <a
      v-for="link in links"
      :key="link.id"
      :href="link.url"
      target="_blank"
      rel="noopener"
      class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-zinc-50 transition-colors"
    >
      <svg
        v-if="getIcon(link.type)"
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        :viewBox="getIcon(link.type)!.viewBox"
        fill="currentColor"
        class="shrink-0"
      >
        <path :d="getIcon(link.type)!.path" />
      </svg>
      <svg
        v-else
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="shrink-0"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
      {{ link.type }}
    </a>
    </div>
  </Dialog>
</template>