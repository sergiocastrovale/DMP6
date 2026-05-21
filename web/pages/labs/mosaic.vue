<script setup lang="ts">
import { Grid3x3, Loader2, Download, Eye, Trash2, Play, Square } from 'lucide-vue-next'
import { useMosaicStore } from '~/stores/mosaic'

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

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-PT', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

const formatSize = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`

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
  <div class="grid gap-6 lg:grid-cols-5">
    <div class="flex flex-col gap-6 lg:col-span-3">
      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <div class="mb-4 flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-amber-500/10">
            <Grid3x3 :size="20" class="text-amber-500" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-zinc-50">Album Mosaic</h2>
            <p class="text-xs text-zinc-400">All your album covers in one image</p>
          </div>
        </div>

        <p class="mb-4 text-sm leading-relaxed text-zinc-400">
          Generates a mosaic of every album cover in your library.
          Chronological sorts by release year. Gradient arranges covers by color temperature — cold tones top-left, warm tones bottom-right.
        </p>

        <div class="mb-4">
          <RadioGroup v-model="mode" :options="modeOptions" />
        </div>

        <button
          v-if="!mosaic.isGenerating"
          class="flex items-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400"
          @click="mosaic.generate(mode)"
        >
          <Play :size="14" />
          Generate
        </button>
        <button
          v-else
          class="flex items-center gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/20"
          @click="mosaic.cancel()"
        >
          <Square :size="14" />
          Cancel
        </button>

        <div v-if="mosaic.isGenerating && mosaic.progress" class="mt-4 space-y-2">
          <div class="flex items-center justify-between text-xs">
            <span class="text-zinc-400">
              Building
              <span class="text-zinc-200">({{ mosaic.progress.current }}/{{ mosaic.progress.total }} images processed)</span>
            </span>
            <span class="text-zinc-500">{{ Math.round(progressPercent) }}%</span>
          </div>
          <div class="h-1.5 w-full rounded-full bg-zinc-800">
            <div
              class="h-1.5 rounded-full bg-amber-500 transition-all duration-300"
              :style="{ width: `${progressPercent}%` }"
            />
          </div>
        </div>

        <div v-if="mosaic.isGenerating && !mosaic.progress" class="mt-4 flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 :size="14" class="animate-spin text-amber-500" />
          Starting...
        </div>

        <p v-if="mosaic.error" class="mt-3 text-xs text-red-400">{{ mosaic.error }}</p>
      </div>

      <div class="rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Mosaic History
        </h3>

        <div v-if="mosaic.mosaics.length === 0" class="text-sm text-zinc-500">
          No mosaics generated yet.
        </div>

        <div v-else class="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
          <div
            v-for="item in mosaic.mosaics"
            :key="item.filename"
            class="flex items-center justify-between px-4 py-3"
          >
            <div>
              <p class="text-sm text-zinc-200">{{ formatDate(item.createdAt) }}</p>
              <p class="text-xs text-zinc-500">
                <span v-if="item.imageCount">{{ item.imageCount }} covers · </span>{{ formatSize(item.size) }}
              </p>
            </div>
            <div class="flex items-center gap-1">
              <button
                class="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-50"
                title="View preview"
                @click="handleView(item)"
              >
                <Eye :size="14" />
              </button>
              <button
                class="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-50"
                title="Download full resolution"
                @click="handleDownload(item.filename)"
              >
                <Download :size="14" />
              </button>
              <button
                class="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-red-400"
                title="Delete"
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
      <div class="sticky top-20 rounded-lg border border-zinc-800 bg-zinc-900 p-5">
        <h3 class="mb-3 text-sm font-semibold uppercase tracking-wider text-zinc-500">
          Preview
        </h3>

        <div v-if="previewUrl" class="cursor-pointer overflow-hidden rounded-lg" title="Click to open full resolution" @click="handleOpenPreview">
          <img
            :src="previewUrl"
            :key="previewUrl"
            alt="Mosaic preview"
            class="w-full transition-opacity hover:opacity-90"
          />
        </div>
        <p v-else class="text-sm text-zinc-500">
          Click the view button on a mosaic to see its preview here.
        </p>
      </div>
    </div>
  </div>

  <Dialog v-model="showDeleteDialog" title="Delete Mosaic">
    <p class="mb-4 text-sm text-zinc-400">
      This will permanently delete this mosaic and its preview. This cannot be undone.
    </p>
    <div class="flex justify-end gap-2">
      <button
        class="rounded-md px-3 py-1.5 text-sm font-medium text-zinc-400 transition-colors hover:text-zinc-50"
        @click="showDeleteDialog = false"
      >
        Cancel
      </button>
      <button
        class="rounded-md bg-red-500/20 border border-red-500/30 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30"
        @click="handleDelete"
      >
        Delete
      </button>
    </div>
  </Dialog>
</template>
