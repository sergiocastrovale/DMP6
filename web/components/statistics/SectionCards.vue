<script setup lang="ts">
import { LucideLink, Info } from 'lucide-vue-next'
import type { StatSection } from '~/types/stats'
import { surface, toneText } from '~/helpers/ui'

defineProps<{
  sections: StatSection[]
}>()

const NuxtLink = resolveComponent('NuxtLink')
</script>

<template>
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <section v-for="section in sections" :key="section.title" :class="surface.card">
      <h2
        :class="[surface.cardHead, section.warn ? toneText.warning : 'text-stone-100/55', 'text-xs font-bold uppercase tracking-[0.1em]']"
      >
        <component :is="section.icon" :class="['size-4', section.warn ? toneText.warning : 'text-amber-400']" />
        {{ section.title }}
      </h2>
      <div class="flex flex-col">
        <component
          :is="item.link ? NuxtLink : 'div'"
          v-for="item in section.items"
          :key="item.label"
          :to="item.link"
          class="flex items-baseline justify-between px-[18px] py-3 border-b border-stone-100/10 last:border-b-0"
          :class="item.link ? 'transition-colors duration-150 hover:bg-stone-800/50' : ''"
        >
          <span class="flex items-center gap-1.5 text-base text-stone-100/60">
            {{ item.label }}
            <Popover v-if="item.info" trigger="hover">
              <template #trigger>
                <Info :size="13" class="text-stone-100/50 transition-colors duration-150 hover:text-amber-400" />
              </template>
              <template #content>
                <div :class="[surface.popover, 'absolute left-0 top-full z-20 mt-1 w-64 p-3']">
                  <p class="text-sm text-stone-100/60">{{ item.info }}</p>
                </div>
              </template>
            </Popover>
            <LucideLink v-if="item.link" :size="13" class="text-stone-100/40" />
          </span>
          <span class="text-lg font-bold tabular-nums" :class="item.link && item.value === 'Browse' ? toneText.warning : 'text-stone-100'">{{ item.value }}</span>
        </component>
      </div>
    </section>
  </div>
</template>
