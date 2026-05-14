<template>
    <Popover trigger="hover">
    <template #trigger>
      <button class="text-zinc-500 transition-colors hover:text-zinc-300">
        <HelpCircle :size="14" />
      </button>
    </template>
    <template #content>
      <div class="absolute right-0 top-full z-20 mt-1 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left shadow-xl">
        <p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
          Artists vs related artists
        </p>
        <p class="mb-2 text-xs text-zinc-300">
          <span class="font-medium text-zinc-50">Artists</span> are the ones you have audio files for - each has its own folder under your music directory.
        </p>
        <p class="text-xs text-zinc-300">
          <span class="font-medium text-zinc-50">Related artists</span> were pulled in by the sync because they collaborate on a release owned by another artist (e.g. featured artists, or splits from compound names like "A &amp; B").
        </p>
      </div>
    </template>
  </Popover>
</template>

<script setup lang="ts">
import Popover from '~/components/Popover.vue'
import { HelpCircle } from 'lucide-vue-next'
</script>
