<script setup lang="ts">
import { formatPlaytime } from '~/helpers/functions'
import type { Statistics } from '~/types/stats'

defineProps<{
  stats: Statistics
}>()

const PLAYTIME_TWINKLES = [
  ['22%', '18%', '0s', 4],
  ['66%', '30%', '.6s', 3],
  ['30%', '84%', '1.2s', 4],
  ['70%', '74%', '1.8s', 3],
] as const
</script>

<template>
  <div
    class="relative overflow-hidden flex flex-col items-center justify-center gap-2.5 py-4 px-6 lg:px-8 lg:py-10 text-center rounded-xl border border-amber-400/30
      bg-[radial-gradient(120%_160%_at_50%_-30%,color-mix(in_oklch,var(--color-amber-400)_24%,transparent)_0%,transparent_60%),linear-gradient(180deg,var(--color-stone-800)_0%,var(--color-stone-900)_55%,#100f0d_100%)]
      shadow-[0_30px_70px_-35px_rgba(0,0,0,.9),inset_0_1px_0_rgba(255,240,210,.07)]"
  >
    <span class="absolute left-1/2 -top-[70%] -translate-x-1/2 w-[130%] aspect-[1.8/1] rounded-[50%] border border-amber-400/25 pointer-events-none" />
    <span class="absolute inset-0 pointer-events-none bg-[repeating-linear-gradient(90deg,rgba(255,240,210,.03)_0_1px,transparent_1px_7px)] mask-[linear-gradient(180deg,transparent_55%,#000_100%)]" />
    <span
      v-for="([top, left, delay, size], i) in PLAYTIME_TWINKLES"
      :key="i"
      class="absolute rounded-full bg-amber-400
        shadow-[0_0_6px_1px_color-mix(in_oklch,var(--color-amber-400)_70%,transparent)]
        animate-[twinkle_2.6s_ease-in-out_infinite] motion-reduce:animate-none motion-reduce:opacity-60"
      :style="{ top, left, animationDelay: delay, width: `${size}px`, height: `${size}px` }"
    />
    <div class="relative flex items-center justify-center gap-3">
      <span class="h-px w-10 bg-amber-400/30" />
      <span class="text-2xs font-medium uppercase tracking-[0.25em] text-amber-400/70">Total Playtime</span>
      <span class="h-px w-10 bg-amber-400/30" />
    </div>
    <p
      class="relative font-display text-2xl lg:text-3xl font-bold tracking-[-0.02em] text-center sm:text-4xl
        text-transparent bg-clip-text bg-size-[220%_100%]
        bg-[linear-gradient(100deg,var(--color-stone-50)_35%,#fff_46%,var(--color-amber-400)_50%,var(--color-stone-50)_62%)]
        animate-[shimmer_4.5s_linear_infinite] motion-reduce:animate-none"
    >
      {{ formatPlaytime(stats.playtime) }}
    </p>
  </div>
</template>