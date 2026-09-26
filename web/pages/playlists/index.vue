<script setup lang="ts">
import { LucidePlus, LucideSettings } from 'lucide-vue-next'
import type { PlaylistSummary } from '~/types/playlist'
import { SKELETON_GRID_SIZE } from '~/helpers/constants'
import { cx, layout } from '~/helpers/ui'
import { useGlobalStore } from '~/stores/global'

useTitle('Playlists')

const { hasPerm, isAdmin } = useAuth()
const canCrud = hasPerm('playlists.crud')
const terminal = useTerminalStore()
const global = useGlobalStore()
const api = useApi()

const loading = ref(true)
const playlists = ref<PlaylistSummary[]>([])
const showCreate = ref(false)

const onCreated = async () => {
  global.stats.playlists++
  await loadPlaylists()
}

const loadPlaylists = async () => {
  loading.value = true
  try {
    playlists.value = await $fetch<PlaylistSummary[]>('/api/playlists')
  }
  catch (e) {
    api.report(e, 'Could not load your playlists')
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

    <PlaylistCreateDialog v-model="showCreate" @created="onCreated" />
  </div>
</template>
