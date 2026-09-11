<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import type { UnifiedRelease } from '~/types/release'
import { useTerminalStore } from '~/stores/terminal'
import { useToastStore } from '~/stores/toast'

const props = defineProps<{
  release: UnifiedRelease
}>()

const open = defineModel<boolean>({ required: true })

const emit = defineEmits<{
  removed: []
}>()

const terminal = useTerminalStore()
const toast = useToastStore()

const removeFiles = ref(false)

const confirmLabel = computed(() => removeFiles.value ? 'Delete release and files' : 'Remove from catalogue')

const note = computed(() =>
  removeFiles.value
    ? 'This release\'s folder is deleted from disk, including cover art and other files in it. A folder that still holds another release\'s audio is kept. This cannot be undone by re-scanning.'
    : 'Files on disk are kept, so a later scan brings this release back. Favorites and playlist entries for its tracks are removed either way. The rest of the catalogue is untouched.',
)

const remove = async () => {
  open.value = false
  const releaseId = props.release.localReleaseId!
  const args = ['--release', releaseId, '--y', ...(removeFiles.value ? ['--files'] : [])]
  await terminal.run('./delete', args, 'dmp-delete-release')
  if (terminal.exitCode === 0) {
    toast.success(`${props.release.title} removed`)
    emit('removed')
    return
  }
  toast.error(`Failed to remove ${props.release.title}`)
}
</script>

<template>
  <ConfirmDialog
    v-model="open"
    title="Remove release"
    :message="`Remove “${release.title}” from the catalogue? This deletes its tracks, cover and, if nothing else uses it, its MusicBrainz edition.`"
    :note="note"
    :confirm-label="confirmLabel"
    :icon="Trash2"
    variant="danger"
    @confirm="remove"
  >
    <Switch v-model="removeFiles" label="Remove the actual files from disk" />
  </ConfirmDialog>
</template>
