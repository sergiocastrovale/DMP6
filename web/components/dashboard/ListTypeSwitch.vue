<script setup lang="ts">
import { LayoutGrid, List } from 'lucide-vue-next'

const viewMode = defineModel<'grid' | 'list'>({ required: true })
</script>

<template>
  <div class="flex items-center gap-1.5">
    <button
      class="w-[30px] h-[30px] rounded grid place-items-center transition-colors"
      :class="viewMode === 'grid' ? 'bg-accent text-accent-ink' : 'text-ink-3 hover:bg-bg-2 hover:text-ink'"
      @click="viewMode = 'grid'"
    >
      <LayoutGrid :size="16" />
    </button>
    <button
      class="w-[30px] h-[30px] rounded grid place-items-center transition-colors"
      :class="viewMode === 'list' ? 'bg-accent text-accent-ink' : 'text-ink-3 hover:bg-bg-2 hover:text-ink'"
      @click="viewMode = 'list'"
    >
      <List :size="16" />
    </button>
  </div>
</template>
