<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next'
import { useTerminalStore } from '~/stores/terminal'
import { useToastStore } from '~/stores/toast'

const props = defineProps<{
  artistName: string
}>()

const open = defineModel<boolean>({ required: true })

const terminal = useTerminalStore()
const toast = useToastStore()
// Captured at setup: the redirect happens after `await terminal.run(...)`, and past that async gap
// there is no Nuxt instance left - navigateTo() throws there, silently stranding the user on a
// deleted artist's page. runWithContext restores it.
const nuxtApp = useNuxtApp()

const removeFiles = ref(false)

const confirmLabel = computed(() => removeFiles.value ? 'Delete artist and files' : 'Remove from catalogue')

const note = computed(() =>
  removeFiles.value
    ? 'Every audio file of this artist inside MUSIC_DIR is deleted from disk, along with the folders they leave empty. This cannot be undone by re-scanning.'
    : 'Files on disk are kept, so a later scan brings this artist back. Favorites, playlist entries and this artist\'s credits on other artists\' tracks are removed either way.',
)

const remove = async () => {
  open.value = false
  const args = [props.artistName, '--y', ...(removeFiles.value ? ['--files'] : [])]
  await terminal.run('./delete', args, 'dmp-delete')
  if (terminal.exitCode === 0) {
    toast.success(`${props.artistName} deleted`)
    await nuxtApp.runWithContext(() => navigateTo('/browse'))
    return
  }
  toast.error(`Failed to delete ${props.artistName}`)
}
</script>

<template>
  <ConfirmDialog
    v-model="open"
    title="Remove artist"
    :message="`Remove ${artistName} from the catalogue? This deletes their releases, tracks, MusicBrainz data and images.`"
    :note="note"
    :confirm-label="confirmLabel"
    :icon="Trash2"
    variant="danger"
    @confirm="remove"
  >
    <Switch v-model="removeFiles" label="Remove all files from this artist" />
  </ConfirmDialog>
</template>
