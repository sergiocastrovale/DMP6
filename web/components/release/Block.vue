<template>
  <div class="group flex flex-col gap-2">
    <div class="relative aspect-square overflow-hidden rounded-lg bg-zinc-800">
      <ReleaseBlockImage :release="release" />
      <ReleaseBlockTogglePlay :release="release" />
    </div>
    <div class="flex flex-col gap-0.5">
      <ReleaseBlockTitle :release="release" />
      <ReleaseBlockArtist :release="release" />
      <ReleaseBlockYear :release="release" />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Release } from '~/types/release'

defineProps<{ release: Release }>()
</script>
