<script setup lang="ts">
import { LucideListMusic, LucideTrash2 } from 'lucide-vue-next'
import { cx, layout } from '~/helpers/ui'

const { loading, playlist, showDeleteConfirm, playAll, removeTrack, deletePlaylist } = usePlaylistPage(useRoute().params.slug as string)
</script>

<template>
  <div :class="cx(layout.page)">
    <UiLoadingBlock v-if="loading" />

    <PlaylistDetail
      v-else-if="playlist"
      :playlist="playlist"
      @play="playAll"
      @delete="showDeleteConfirm = true"
      @remove-track="removeTrack"
    />

    <UiEmptyState v-else :icon="LucideListMusic" message="Playlist not found">
      <template #action>
        <UiButton variant="secondary" size="sm" to="/playlists" class="mt-1">
          Back to playlists
        </UiButton>
      </template>
    </UiEmptyState>

    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="Delete Playlist"
      :message="`Are you sure you want to delete &quot;${playlist?.name}&quot;? This action cannot be undone.`"
      confirm-label="Delete"
      variant="danger"
      :icon="LucideTrash2"
      @confirm="deletePlaylist"
    />
  </div>
</template>
