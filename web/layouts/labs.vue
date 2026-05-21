<script setup lang="ts">
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-50">
    <LabsHeader />

    <main
      class="mx-auto max-w-7xl px-4 py-6 lg:px-8"
      :class="{ 'pb-40 lg:pb-24': player.isVisible, 'pb-20 lg:pb-6': !player.isVisible }"
    >
      <slot />
    </main>

    <PlayerAudioPlayer />
  </div>
</template>
