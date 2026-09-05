<script setup lang="ts">
import { Grid3x3, Loader2, Download, Eye, Trash2, Play, Square } from 'lucide-vue-next'
import { formatDate } from '~/helpers/functions'
import { useMosaicStore } from '~/stores/mosaic'
import { cx, typography, ICON_STROKE_WIDTH, layout } from '~/helpers/ui'

useTitle('Labs', 'Album Mosaic')

definePageMeta({ layout: 'labs' })

const mosaic = useMosaicStore()
const mode = ref('chronological')
const previewFilename = ref<string | null>(null)
const deleteTarget = ref<string | null>(null)
const showDeleteDialog = ref(false)

const modeOptions = [
  { value: 'chronological', label: 'Chronological' },
  { value: 'gradient', label: 'Gradient' },
]

const previewUrl = computed(() =>
  previewFilename.value ? `/img/labs/${previewFilename.value}` : null,
)

const fullFilenameForPreview = computed(() => {
  if (!previewFilename.value) { return null }
  return previewFilename.value.replace('_preview', '')
})

const progressPercent = computed(() => {
  if (!mosaic.progress) { return 0 }
  return Math.min(100, (mosaic.progress.current / Math.max(1, mosaic.progress.total)) * 100)
})

const formatSize = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`

// What the preview is actually showing, matched back from the filename so the footer can describe
// it. The mosaic record stores no sort mode or pixel dimensions, so the footer reports the two
// facts that are real - the cover count and the file size - rather than inventing the rest.
const previewItem = computed(() =>
  mosaic.mosaics.find(m => (m.previewFilename || m.filename) === previewFilename.value) ?? null,
)

const modeDescription = computed(() =>
  mode.value === 'gradient' ? 'Arranged by colour temperature' : 'Sorted by release year',
)

const handleView = (item: { previewFilename: string | null; filename: string }) => {
  previewFilename.value = item.previewFilename || item.filename
}

const handleDownload = (filename: string) => {
  const link = document.createElement('a')
  link.href = `/img/labs/${filename}`
  link.download = filename
  link.click()
}

const handleOpenPreview = () => {
  if (fullFilenameForPreview.value) {
    window.open(`/img/labs/${fullFilenameForPreview.value}`, '_blank')
  }
}

const confirmDelete = (filename: string) => {
  deleteTarget.value = filename
  showDeleteDialog.value = true
}

const handleDelete = async () => {
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
</script>

<template>
  <div :class="cx(layout.page)">
    <LabsBackLink />

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="flex flex-col gap-6 lg:col-span-3">
        <UiCard padding="sm" :icon="Grid3x3" title="Album Mosaic" subtitle="All your album covers in one image">
          <p class="text-base leading-relaxed text-stone-100/60">
            Generates a mosaic of every album cover in your library.
            Chronological sorts by release year. Gradient arranges covers by color temperature - cold tones top-left, warm tones bottom-right.
          </p>

          <LabsRadioGroup v-model="mode" :options="modeOptions" />

          <div>
            <UiButton v-if="!mosaic.isGenerating" :icon="Play" @click="mosaic.generate(mode)">
              Generate
            </UiButton>
            <UiButton v-else variant="danger" :icon="Square" @click="mosaic.cancel()">
              Cancel
            </UiButton>
          </div>

          <UiLoadingPanel
            v-if="mosaic.isGenerating && mosaic.progress"
            :label="`Building (${mosaic.progress.current}/${mosaic.progress.total} images processed)`"
            :percent="progressPercent"
          />

          <div v-if="mosaic.isGenerating && !mosaic.progress" class="flex items-center gap-2 text-base text-stone-100/60">
            <Loader2 :size="14" :stroke-width="ICON_STROKE_WIDTH" class="animate-spin text-amber-400" />
            Starting...
          </div>

          <p v-if="mosaic.error" class="text-sm text-danger">{{ mosaic.error }}</p>
        </UiCard>

        <UiCard padding="sm" title="Mosaic History">
          <UiEmptyState v-if="mosaic.mosaics.length === 0" message="No mosaics generated yet." />

          <div v-else class="divide-y divide-stone-100/6 rounded-lg border border-stone-100/6">
            <div
              v-for="item in mosaic.mosaics"
              :key="item.filename"
              class="flex items-center justify-between px-4 py-3"
            >
              <div>
                <p class="text-base text-stone-100">{{ formatDate(item.createdAt) }}</p>
                <p class="text-sm text-stone-100/55">
                  <span v-if="item.imageCount">{{ item.imageCount }} covers · </span>{{ formatSize(item.size) }}
                </p>
              </div>
              <div class="flex items-center gap-1">
                <UiButton
                  variant="ghost"
                  size="sm"
                  icon-only
                  :icon="Eye"
                  aria-label="View preview"
                  @click="handleView(item)"
                />
                <UiButton
                  variant="ghost"
                  size="sm"
                  icon-only
                  :icon="Download"
                  aria-label="Download full resolution"
                  @click="handleDownload(item.filename)"
                />
                <UiButton
                  variant="ghost"
                  size="sm"
                  icon-only
                  :icon="Trash2"
                  aria-label="Delete"
                  class="hover:text-danger"
                  @click="confirmDelete(item.filename)"
                />
              </div>
            </div>
          </div>
        </UiCard>
      </div>

      <div class="lg:col-span-2">
        <UiCard padding="sm" title="Preview" class="sticky top-20">
          <button
            v-if="previewUrl"
            type="button"
            class="block w-full cursor-pointer overflow-hidden rounded-lg"
            title="Click to open full resolution"
            @click="handleOpenPreview"
          >
            <img
              :key="previewUrl"
              :src="previewUrl"
              alt="Mosaic preview"
              class="w-full transition-opacity duration-150 hover:opacity-90"
            >
          </button>
          <p v-else class="text-base text-stone-100/55">
            Click the view button on a mosaic to see its preview here.
          </p>

          <div v-if="previewUrl" class="mt-3 flex items-baseline justify-between gap-3">
            <span class="text-sm text-stone-100/55">{{ modeDescription }}</span>
            <span v-if="previewItem" :class="typography.meta">
              <template v-if="previewItem.imageCount">{{ previewItem.imageCount.toLocaleString() }} covers · </template>{{ formatSize(previewItem.size) }}
            </span>
          </div>
        </UiCard>
      </div>
    </div>

    <ConfirmDialog
      v-model="showDeleteDialog"
      title="Delete Mosaic"
      message="This will permanently delete this mosaic and its preview. This cannot be undone."
      confirm-label="Delete"
      variant="danger"
      :icon="Trash2"
      @confirm="handleDelete"
    />
  </div>
</template>