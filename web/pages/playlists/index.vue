<script setup lang="ts">
import { LucidePlus, LucideSettings } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'
import { cx, layout } from '~/helpers/ui'

useTitle('Playlists')

const { hasPerm, isAdmin } = useAuth()
const canCrud = hasPerm('playlists.crud')
const terminal = useTerminalStore()

const loading = ref(true)
const playlists = ref<PlaylistSummary[]>([])
const showCreate = ref(false)

async function loadPlaylists() {
  loading.value = true
  try {
    playlists.value = await $fetch<PlaylistSummary[]>('/api/playlists')
  }
  catch (error) {
    console.error('Failed to load playlists:', error)
  }
  finally {
    loading.value = false
  }
}

watch(() => terminal.isRunning, (running, was) => {
  if (was && !running) {
    loadPlaylists()
  }
})

onMounted(() => loadPlaylists())
</script>

<template>
  <div :class="cx(layout.page)">
    <PageTitle text="Playlists">
      <div class="flex items-center gap-2">
        <UiButton v-if="canCrud" :icon="LucidePlus" @click="showCreate = true">
          <span class="hidden lg:block">New Playlist</span>
        </UiButton>
        <UiButton
          v-if="isAdmin"
          variant="secondary"
          icon-only
          :icon="LucideSettings"
          to="/playlists/setup/generated"
          aria-label="Generated playlist settings"
          title="Generated playlist settings"
        />
      </div>
    </PageTitle>

    <PlaylistLoadingGrid v-if="loading" :count="SKELETON_GRID_SIZE" />

    <PlaylistList v-else :playlists="playlists" @create="showCreate = true" />

    <PlaylistCreateDialog v-model="showCreate" @created="loadPlaylists" />
  </div>
</template>
