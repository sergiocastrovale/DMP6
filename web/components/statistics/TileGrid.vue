<script setup lang="ts">
import type { StatTile } from '~/types/stats'
import { surface } from '~/helpers/ui'

defineProps<{
  tiles: StatTile[]
}>()
</script>

<template>
  <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
    <NuxtLink
      v-for="tile in tiles"
      :key="tile.label"
      :to="tile.link"
      :class="[surface.card, 'flex flex-col gap-3 p-5 transition-colors duration-150 hover:border-stone-100/15']"
    >
      <component :is="tile.icon" class="size-5 text-amber-400" />
      <div>
        <p class="font-display text-2xl font-bold text-stone-100 tabular-nums">{{ tile.value }}</p>
        <p class="text-sm text-stone-100/55">{{ tile.label }}</p>
      </div>
    </NuxtLink>
  </div>
</template>
