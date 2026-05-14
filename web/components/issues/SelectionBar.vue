<script setup lang="ts">
import { Wrench, HelpCircle } from 'lucide-vue-next'
import type { IssueType } from '~/types/issues'

const props = defineProps<{ count: number; type: IssueType; loading: boolean }>()
const emit = defineEmits<{ fix: [] }>()

const FILE_WRITING_TYPES: IssueType[] = ['corrupted', 'unsplit', 'missing']

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
      body: 'Merges artist B into artist A in the database — all releases and tracks are re-assigned to A, then B is deleted. No audio files are touched.',
    }
  }
  return null
})
</script>

<template>
  <Transition
    enter-active-class="transition-transform duration-200 ease-out"
    enter-from-class="translate-y-full"
    enter-to-class="translate-y-0"
    leave-active-class="transition-transform duration-150 ease-in"
    leave-from-class="translate-y-0"
    leave-to-class="translate-y-full"
  >
    <div
      v-if="count > 0"
      class="fixed bottom-0 left-0 right-0 z-30 flex items-center justify-between border-t border-zinc-700 bg-zinc-900 px-6 py-3"
    >
      <span class="text-sm text-zinc-300">{{ count }} row{{ count !== 1 ? 's' : '' }} selected</span>
      <div class="flex items-center gap-2">
        <Popover v-if="fixDescription" trigger="hover">
          <template #trigger>
            <button class="text-zinc-500 transition-colors hover:text-zinc-300">
              <HelpCircle :size="14" />
            </button>
          </template>
          <template #content>
            <div class="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left shadow-xl">
              <p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                {{ fixDescription.title }}
              </p>
              <p class="text-xs text-zinc-300">{{ fixDescription.body }}</p>
            </div>
          </template>
        </Popover>
        <button
          :disabled="loading"
          @click="emit('fix')"
          class="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          <Wrench :size="15" />
          Fix Selected
        </button>
      </div>
    </div>
  </Transition>
</template>
