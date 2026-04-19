<script setup lang="ts">
import { Loader2, RefreshCw } from 'lucide-vue-next'
import type { ButtonDropdownOption } from '~/components/ButtonDropdown.vue'
import { useTerminalStore } from '~/stores/terminal'

const route = useRoute()
const slug = computed(() => route.params.slug as string)
const terminal = useTerminalStore()

const { data: artist, pending, error } = useFetch(() => `/api/artists/${slug.value}`, {
  key: `artist-${slug.value}`,
})

const syncOptions = computed<ButtonDropdownOption[]>(() => {
  const name = artist.value?.name ?? ''
  return [
    {
      label: 'Update',
      description: 'Sync new & changed files',
      action: () => terminal.run('./sync', ['--only', name]),
    },
    {
      label: 'Re-sync',
      description: 'Nuke & rebuild from scratch',
      action: () => terminal.run('./sync', ['--only', name, '--overwrite']),
    },
    {
      label: 'Refresh local catalogue',
      description: 'Re-index files without MusicBrainz',
      action: () => terminal.run('./sync', ['--local-only', '--only', name]),
    },
  ]
})
</script>

<template>
  <div>
    <div v-if="pending" class="flex items-center justify-center py-20">
      <Loader2 :size="24" class="animate-spin text-zinc-500" />
    </div>
    <div v-else-if="error" class="py-20 text-center">
      <p class="text-lg font-medium text-zinc-50">Artist not found</p>
      <p class="mt-1 text-sm text-zinc-400">The artist you're looking for doesn't exist.</p>
    </div>
    <div v-else-if="artist" class="flex flex-col gap-8">
      <div class="flex items-start justify-between gap-4">
        <ArtistHeader :artist="artist" class="min-w-0" />
        <div class="flex items-center gap-2">
          <UiReindexSyncButton :only="[artist.name]" />
          <ButtonDropdown
            label="Sync"
            :options="syncOptions"
            :disabled="terminal.isRunning"
          >
            <template #icon>
              <Loader2 v-if="terminal.isRunning" :size="14" class="animate-spin" />
              <RefreshCw v-else :size="14" />
            </template>
          </ButtonDropdown>
        </div>
      </div>
      <ArtistReleases :slug="artist.slug" :artist-name="artist.name" />
    </div>
  </div>
</template>
