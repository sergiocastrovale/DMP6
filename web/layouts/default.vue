<script setup lang="ts">
import { usePlayerStore } from '~/stores/player'

const player = usePlayerStore()
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-50">
    <!-- Sidebar (desktop) -->
    <LayoutSidebar class="hidden lg:flex" />

    <!-- Mobile bottom nav -->
    <LayoutMobileNav />

    <!-- Main content -->
    <div class="lg:ml-56 transition-all duration-200">
      <!-- Top bar with search -->
      <header class="sticky top-0 z-30 flex h-14 items-center justify-end border-b border-zinc-800 bg-zinc-950/80 px-4 backdrop-blur-sm lg:px-6">
        <LayoutSearchBar />
      </header>

      <!-- Page content -->
      <main
        class="px-4 py-6 lg:px-6"
        :class="{ 'pb-36': player.isVisible, 'pb-20 lg:pb-6': !player.isVisible }"
      >
        <slot />
      </main>
    </div>

    <!-- Audio player -->
    <PlayerAudioPlayer />
  </div>
</template>
