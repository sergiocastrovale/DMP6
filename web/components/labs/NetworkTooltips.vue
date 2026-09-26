<script setup lang="ts">
defineProps<{
  node: { x: number, y: number, name: string, tracks: number } | null
  link: { x: number, y: number, source: string, target: string, shared: number, tracks: string[] } | null
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="node"
      class="pointer-events-none fixed z-[2000] rounded-lg border border-stone-100/10 bg-stone-900 px-3 py-2 shadow-lg"
      :style="{ left: `${node.x + 12}px`, top: `${node.y - 10}px` }"
    >
      <div class="text-base font-semibold text-stone-100">{{ node.name }}</div>
      <div class="text-sm text-stone-100/60">
        {{ node.tracks }} {{ node.tracks === 1 ? 'track' : 'tracks' }}
      </div>
    </div>

    <div
      v-if="link"
      class="pointer-events-none fixed z-[2000] max-w-xs rounded-lg border border-stone-100/10 bg-stone-900 px-3 py-2 shadow-lg"
      :style="{ left: `${link.x + 12}px`, top: `${link.y - 10}px` }"
    >
      <div class="text-base font-semibold text-stone-100">{{ link.source }} × {{ link.target }}</div>
      <div class="text-sm text-stone-100/60">{{ link.shared }} shared tracks</div>
      <div v-if="link.tracks.length > 0" class="mt-1 flex flex-col gap-0.5">
        <div v-for="track in link.tracks.slice(0, 5)" :key="track" class="truncate text-[10px] text-stone-100/60">
          {{ track }}
        </div>
        <div v-if="link.tracks.length > 5" class="text-[10px] text-stone-100/60">
          +{{ link.tracks.length - 5 }} more
        </div>
      </div>
    </div>
  </Teleport>
</template>
