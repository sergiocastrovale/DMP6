<script setup lang="ts">
import type { Release } from '~/types/release'

defineProps<{ release: Release }>()
</script>

<template>
  <article class="cursor-pointer flex flex-col gap-3 group">
    <DashboardCardCover :release="release" />
    <div class="flex flex-col gap-0.5 min-w-0">
      <DashboardCardTitle :release="release" />
      <DashboardCardDetails :release="release" />
    </div>
  </article>
</template>
