<template>
  <Popover trigger="hover">
    <template #trigger>
      <button class="text-ink0 hover:text-ink-2 transition-colors">
        <LucideHelpCircle class="size-3.5" />
      </button>
    </template>
    <template #content>
      <div class="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-rule bg-bg-1 p-3 shadow-xl">
        <p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-2">How genre playlists work</p>
        <div class="flex flex-col gap-2 text-xs text-ink-2">
          <p>Each playlist groups related genres under a single theme (e.g. "Rock" covers rock, punk, metal and their subgenres).</p>
          <p>Tracks are pulled from your local library based on the genres tagged in MusicBrainz. The playlist updates whenever you run Regenerate.</p>
        </div>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import { LucideHelpCircle } from 'lucide-vue-next'
</script>
