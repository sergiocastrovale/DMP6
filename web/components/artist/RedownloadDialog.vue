<script setup lang="ts">
import { DownloadCloud } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'

const props = defineProps<{
  modelValue: boolean
  release: UnifiedRelease | null
  artistName?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: []
}>()

const edition = computed(() => props.release?.disambiguation || props.release?.editionLabel)
const type = computed(() => props.release?.type)
</script>

<template>
  <ConfirmDialog
    :model-value="modelValue"
    title="Re-download release"
    message="Are you sure you want to re-download this release? The current release will be removed IF we manage to download it again; the new one will then replace it once you approve the merge."
    confirm-label="Re-download"
    :icon="DownloadCloud"
    size="lg"
    @update:model-value="emit('update:modelValue', $event)"
    @confirm="emit('confirm')"
  >
    <div v-if="release" class="text-sm border border-stone-100/6 bg-stone-950 px-5 py-5 rounded-md">
      <div class="truncate">
        <template v-if="artistName">{{ artistName }} &middot; </template>{{ release.title }}
      </div>

      <div class="mt-0.5 flex items-center gap-1.5 text-xs text-stone-100/45">
        <span v-if="release.year">{{ release.year }}</span>

        <template v-if="type">
          <span>&middot;</span>
          <span>{{ type }}</span>
        </template>

        <template v-if="edition">
          <span>&middot;</span>
          <span>{{ edition }}</span>
        </template>
      </div>
    </div>
  </ConfirmDialog>
</template>
