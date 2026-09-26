<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { cx, layout } from '~/helpers/ui'

useTitle('Labs', 'Album Mosaic')

definePageMeta({ layout: 'labs' })

const {
  mosaic, mode, previewUrl, previewItem, modeDescription, showDeleteDialog,
  view, download, openPreview, confirmDelete, deleteConfirmed,
} = useMosaicPage()
</script>

<template>
  <div :class="cx(layout.page, 'max-w-none')">
    <LabsBackLink />

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="flex flex-col gap-6 lg:col-span-3">
        <LabsMosaicGenerator v-model:mode="mode" />
        <LabsMosaicHistory :items="mosaic.mosaics" @view="view" @download="download" @delete="confirmDelete" />
      </div>

      <div class="lg:col-span-2">
        <LabsMosaicPreview :url="previewUrl" :item="previewItem" :description="modeDescription" @open="openPreview" />
      </div>
    </div>

    <ConfirmDialog
      v-model="showDeleteDialog"
      title="Delete Mosaic"
      message="This will permanently delete this mosaic and its preview. This cannot be undone."
      confirm-label="Delete"
      variant="danger"
      :icon="Trash2"
      @confirm="deleteConfirmed"
    />
  </div>
</template>
