<script setup lang="ts">
import { Grid3x3, Loader2, Download, Eye, Trash2, Play, Square } from 'lucide-vue-next'
import { formatDate } from '~/helpers/functions'
import { useMosaicStore } from '~/stores/mosaic'
import { typography } from '~/helpers/ui'

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
  <div class="flex flex-col gap-4">
    <LabsBackLink />

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="flex flex-col gap-6 lg:col-span-3">
        <div class="rounded-xl border border-stone-100/6 bg-stone-900 p-5">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-amber-400/10">
              <Grid3x3 :size="20" class="text-amber-400" />
            </div>
            <div>
              <h2 class="text-lg font-semibold text-stone-100">Album Mosaic</h2>
              <p class="text-sm text-stone-100/55">All your album covers in one image</p>
            </div>
          </div>

          <p class="mb-4 text-base leading-relaxed text-stone-100/60">
            Generates a mosaic of every album cover in your library.
            Chronological sorts by release year. Gradient arranges covers by color temperature - cold tones top-left, warm tones bottom-right.
          </p>

          <div class="mb-4">
            <RadioGroup v-model="mode" :options="modeOptions" />
          </div>

          <UiButton v-if="!mosaic.isGenerating" :icon="Play" @click="mosaic.generate(mode)">
            Generate
          </UiButton>
          <UiButton v-else variant="danger" :icon="Square" @click="mosaic.cancel()">
            Cancel
          </UiButton>

          <div v-if="mosaic.isGenerating && mosaic.progress" class="mt-4 flex flex-col gap-2">
            <div class="flex items-center justify-between text-sm">
              <span class="text-stone-100/60">
                Building
                <span class="text-stone-100">({{ mosaic.progress.current }}/{{ mosaic.progress.total }} images processed)</span>
              </span>
              <span class="text-stone-100/55 tabular-nums">{{ Math.round(progressPercent) }}%</span>
            </div>
            <div class="h-1.5 w-full rounded-full bg-stone-800">
              <div
                class="h-1.5 rounded-full bg-amber-400 transition-all duration-300"
                :style="{ width: `${progressPercent}%` }"
              />
            </div>
          </div>

          <div v-if="mosaic.isGenerating && !mosaic.progress" class="mt-4 flex items-center gap-2 text-base text-stone-100/60">
            <Loader2 :size="14" class="animate-spin text-amber-400" />
            Starting...
          </div>

          <p v-if="mosaic.error" class="mt-3 text-sm text-danger">{{ mosaic.error }}</p>
        </div>

        <div class="rounded-xl border border-stone-100/6 bg-stone-900 p-5">
          <h3 class="mb-3 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">
            Mosaic History
          </h3>

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
                <button
                  type="button"
                  class="rounded-md p-1.5 text-stone-100/60 transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100"
                  aria-label="View preview"
                  @click="handleView(item)"
                >
                  <Eye :size="14" />
                </button>
                <button
                  type="button"
                  class="rounded-md p-1.5 text-stone-100/60 transition-colors duration-150 hover:bg-stone-800 hover:text-stone-100"
                  aria-label="Download full resolution"
                  @click="handleDownload(item.filename)"
                >
                  <Download :size="14" />
                </button>
                <button
                  type="button"
                  class="rounded-md p-1.5 text-stone-100/60 transition-colors duration-150 hover:bg-stone-800 hover:text-danger"
                  aria-label="Delete"
                  @click="confirmDelete(item.filename)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="lg:col-span-2">
        <div class="sticky top-20 rounded-xl border border-stone-100/6 bg-stone-900 p-5">
          <h3 class="mb-3 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/55">
            Preview
          </h3>

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
        </div>
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