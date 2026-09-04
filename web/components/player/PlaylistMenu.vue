<script setup lang="ts">
import { Check, ListPlus, Plus } from 'lucide-vue-next'
import { cx, ICON_STROKE_WIDTH, surface } from '~/helpers/ui'

withDefaults(defineProps<{
  open: boolean
  playlists: any[]
  selectedSlugs: Set<string>
  // Desktop bar opens upward (it sits at the bottom of the viewport); the mobile sheet's
  // secondary row has room below it and opens downward.
  placement?: 'up' | 'down'
}>(), {
  placement: 'up',
})

const emit = defineEmits<{
  toggleOpen: []
  toggle: [slug: string]
  createNew: []
}>()
</script>

<template>
  <div class="relative">
    <UiButton
      variant="secondary"
      icon-only
      :icon="ListPlus"
      :on="open"
      aria-label="Add to playlist"
      aria-haspopup="menu"
      :aria-expanded="open"
      @click="emit('toggleOpen')"
    />
    <div
      v-if="open"
      role="menu"
      :class="cx(surface.popover, 'absolute z-20 w-48', placement === 'up' ? 'bottom-full left-0 mb-2' : 'top-full left-0 mt-2')"
    >
      <div class="max-h-64 overflow-y-auto p-2">
        <div class="mb-2 flex justify-center">
          <UiButton variant="quiet" size="sm" on :icon="Plus" @click="emit('createNew')">
            Create new playlist
          </UiButton>
        </div>
        <div v-if="playlists.length > 0" class="border-t border-stone-100/6 pt-2">
          <button
            v-for="playlist in playlists"
            :key="playlist.id"
            type="button"
            role="menuitemcheckbox"
            :aria-checked="selectedSlugs.has(playlist.slug)"
            :class="cx('flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-stone-800', selectedSlugs.has(playlist.slug) ? 'text-amber-400' : 'text-stone-100/60')"
            @click="emit('toggle', playlist.slug)"
          >
            {{ playlist.name }}
            <Check v-if="selectedSlugs.has(playlist.slug)" :size="14" :stroke-width="ICON_STROKE_WIDTH" />
          </button>
        </div>
        <div v-if="playlists.length === 0" class="px-3 py-2 text-sm text-stone-100/55">
          No playlists yet
        </div>
      </div>
    </div>
  </div>
</template>
