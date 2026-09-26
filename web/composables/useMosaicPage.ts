import { useMosaicStore } from '~/stores/mosaic'
import type { MosaicItem } from '~/types/labs'

// State behind Labs -> Album Mosaic: which mosaic the preview shows, the generation mode, and the delete flow.
export const useMosaicPage = () => {
  const mosaic = useMosaicStore()
  const mode = ref('chronological')
  const previewFilename = ref<string | null>(null)
  const deleteTarget = ref<string | null>(null)
  const showDeleteDialog = ref(false)

  const previewUrl = computed(() =>
    previewFilename.value ? `/img/labs/${previewFilename.value}` : null,
  )

  const fullFilenameForPreview = computed(() =>
    previewFilename.value ? previewFilename.value.replace('_preview', '') : null,
  )

  // What the preview is actually showing, matched back from the filename so the footer can describe it. The mosaic
  // record stores no sort mode or pixel dimensions, so the footer reports the two facts that are real - the cover
  // count and the file size - rather than inventing the rest.
  const previewItem = computed(() =>
    mosaic.mosaics.find(m => (m.previewFilename || m.filename) === previewFilename.value) ?? null,
  )

  const modeDescription = computed(() =>
    mode.value === 'gradient' ? 'Arranged by colour temperature' : 'Sorted by release year',
  )

  const view = (item: Pick<MosaicItem, 'previewFilename' | 'filename'>) => {
    previewFilename.value = item.previewFilename || item.filename
  }

  const download = (filename: string) => {
    const link = document.createElement('a')
    link.href = `/img/labs/${filename}`
    link.download = filename
    link.click()
  }

  const openPreview = () => {
    if (fullFilenameForPreview.value) {
      window.open(`/img/labs/${fullFilenameForPreview.value}`, '_blank')
    }
  }

  const confirmDelete = (filename: string) => {
    deleteTarget.value = filename
    showDeleteDialog.value = true
  }

  const deleteConfirmed = async () => {
    if (!deleteTarget.value) { return }
    if (previewFilename.value?.includes(deleteTarget.value.replace('.jpg', ''))) {
      previewFilename.value = null
    }
    await mosaic.deleteMosaic(deleteTarget.value)
    showDeleteDialog.value = false
    deleteTarget.value = null
  }

  watch(() => mosaic.lastResult, (result) => {
    if (result?.preview) {
      previewFilename.value = result.preview
    }
  })

  onMounted(async () => {
    await mosaic.loadMosaics()
    const latest = mosaic.mosaics[0]
    if (latest) {
      previewFilename.value = latest.previewFilename || latest.filename
    }
  })

  return {
    mosaic, mode, previewUrl, previewItem, modeDescription, showDeleteDialog,
    view, download, openPreview, confirmDelete, deleteConfirmed,
  }
}
