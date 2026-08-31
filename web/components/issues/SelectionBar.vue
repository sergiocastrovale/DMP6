<script setup lang="ts">
import { Wrench, CircleHelp } from 'lucide-vue-next'
import type { IssueType } from '~/types/issues'
import { surface } from '~/helpers/ui'

const props = defineProps<{ count: number; type: IssueType; loading: boolean }>()
const emit = defineEmits<{ fix: [], cancel: [] }>()

const FILE_WRITING_TYPES: IssueType[] = ['corrupted', 'missing']

const fixDescription = computed(() => {
  if (FILE_WRITING_TYPES.includes(props.type)) {
    return {
      title: 'Writes tags to audio files',
      body: 'Queues the selected rows as PENDING, then runs the fix script which physically rewrites the relevant ID3/Vorbis tags in your audio files on disk. A re-index is required afterward to pull the new values into the database.',
    }
  }
  if (props.type === 'orphans') {
    return {
      title: 'Deletes from database only',
      body: 'Removes the selected orphan artist records from the database. No audio files are touched.',
    }
  }
  if (props.type === 'duplicates') {
    return {
      title: 'Merges records in database only',
      body: 'Merges artist B into artist A in the database - all releases and tracks are re-assigned to A, then B is deleted. No audio files are touched.',
    }
  }
  return null
})
</script>

<template>
  <UiBulkBar :count="count" @cancel="emit('cancel')">
    <Popover v-if="fixDescription" trigger="hover">
      <template #trigger>
        <button type="button" aria-label="What does this fix do?" class="text-stone-100/40 transition-colors duration-150 hover:text-stone-100/60">
          <CircleHelp :size="14" />
        </button>
      </template>
      <template #content>
        <div :class="[surface.popover, 'absolute bottom-full right-0 z-20 mb-2 w-72 p-3 text-left']">
          <p class="mb-2 text-2xs font-bold uppercase tracking-[0.1em] text-stone-100/40">
            {{ fixDescription.title }}
          </p>
          <p class="text-sm text-stone-100/60">{{ fixDescription.body }}</p>
        </div>
      </template>
    </Popover>
    <UiButton size="sm" variant="quiet" :icon="Wrench" :loading="loading" @click="emit('fix')">
      Fix Selected
    </UiButton>
  </UiBulkBar>
</template>
