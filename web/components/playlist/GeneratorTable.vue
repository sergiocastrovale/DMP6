<script setup lang="ts">
import { LucideArrowLeft, LucidePlus, LucidePencil, LucideTrash2 } from 'lucide-vue-next'
import type { PlaylistGeneratorRow } from '~/types/playlistGenerator'
import { cx, data, layout } from '~/helpers/ui'
import { formatDate } from '~/helpers/functions'

const toast = useToastStore()
const terminal = useTerminalStore()

const loading = ref(true)
const rows = ref<PlaylistGeneratorRow[]>([])
const deleteTarget = ref<PlaylistGeneratorRow | null>(null)

const hasGenerated = computed(() => rows.value.some(r => r.generatedAt))

const loadRows = async () => {
  loading.value = true
  try {
    rows.value = await $fetch<PlaylistGeneratorRow[]>('/api/playlist-generators')
  }
  catch (error) {
    console.error('Failed to load playlist generators:', error)
  }
  finally {
    loading.value = false
  }
}

watch(() => terminal.isRunning, (running, was) => {
  if (was && !running) {
    loadRows()
  }
})

const confirmDelete = async () => {
  const target = deleteTarget.value
  if (!target) { return }
  try {
    await $fetch(`/api/playlist-generators/${target.id}`, { method: 'DELETE' })
    rows.value = rows.value.filter(r => r.id !== target.id)
    toast.success(`Removed "${target.name}"`)
  }
  catch (e: any) {
    toast.error(e?.data?.statusMessage || e?.data?.message || 'Failed to remove playlist generator')
  }
  finally {
    deleteTarget.value = null
  }
}

const termsPreview = (row: PlaylistGeneratorRow): string => {
  const kept = row.terms.filter(t => !t.startsWith('-'))
  const shown = kept.slice(0, 4).join(', ')
  return kept.length > 4 ? `${shown}, +${kept.length - 4} more` : shown
}

onMounted(() => loadRows())
</script>

<template>
  <div :class="cx(layout.page)">
    <UiButton variant="ghost" size="sm" :icon="LucideArrowLeft" to="/playlists" class="self-start">
      Back to playlists
    </UiButton>

    <PageTitle text="Generated playlists" subtext="Seeds for genre and region playlists, read by ./playlists on every (re)generate.">
      <div class="flex items-center gap-2">
        <PlaylistButtonGeneratePlaylists :regenerate="hasGenerated" />
        <UiButton :icon="LucidePlus" to="/playlists/setup/generated/new">
          <span class="hidden lg:block">Add</span>
        </UiButton>
      </div>
    </PageTitle>

    <UiHint>
      A <span class="text-stone-100">Genre</span> generator's terms are keywords, one per line: a
      library genre matches if it equals a line exactly, or contains it as a whole word ("rock"
      also catches "hard rock"). A line starting with "-" excludes an exact genre name instead
      (e.g. "-indie rock"). A <span class="text-stone-100">Region</span> generator's terms are ISO
      3166-1 alpha-2 country codes (e.g. "JP"), matched against each artist's country. Each run
      selects up to 500 tracks per playlist, max 3 per release, and skips groups under 10 tracks.
      Changes here take effect on the next Generate/Regenerate.
    </UiHint>

    <UiLoadingBlock v-if="loading" />

    <UiEmptyState v-else-if="rows.length === 0" message="No playlist generators yet" />

    <SlimTable v-else>
      <SlimTableHeader>
        <th :class="cx(data.th, 'text-left')">Name</th>
        <th :class="cx(data.th, 'text-left')">Type</th>
        <th :class="cx(data.th, 'text-left')">Terms</th>
        <th :class="cx(data.th, 'text-center')">Tracks</th>
        <th :class="cx(data.th, 'text-left')">Last generated</th>
        <th :class="cx(data.th, 'text-right')">Actions</th>
      </SlimTableHeader>
      <SlimTableBody>
        <SlimTableRow v-for="row in rows" :key="row.id">
          <td :class="data.td">
            <NuxtLink :to="`/playlists/setup/generated/${row.id}`" class="text-stone-100 transition-colors duration-150 hover:text-amber-400">
              {{ row.name }}
            </NuxtLink>
          </td>
          <td :class="data.td">
            <UiBadge :tone="row.type === 'GENRE' ? 'accent' : 'info'">
              {{ row.type === 'GENRE' ? 'Genre' : 'Region' }}
            </UiBadge>
          </td>
          <td :class="cx(data.td, 'max-w-md truncate text-stone-100/55')" :title="row.terms.join(', ')">
            {{ termsPreview(row) }}
          </td>
          <td :class="cx(data.td, 'text-center tabular-nums text-stone-100/55')">
            {{ row.trackCount ?? '—' }}
          </td>
          <td :class="cx(data.td, 'text-stone-100/55')">
            {{ formatDate(row.generatedAt) }}
          </td>
          <td :class="cx(data.td, 'text-right')" @click.stop>
            <div class="flex items-center justify-end gap-1.5">
              <DataTableAction :icon="LucidePencil" :label="`Edit ${row.name}`" :to="`/playlists/setup/generated/${row.id}`" />
              <DataTableAction :icon="LucideTrash2" :label="`Remove ${row.name}`" @click="deleteTarget = row" />
            </div>
          </td>
        </SlimTableRow>
      </SlimTableBody>
    </SlimTable>

    <ConfirmDialog
      :model-value="!!deleteTarget"
      title="Remove playlist generator"
      :message="`Remove &quot;${deleteTarget?.name}&quot;?`"
      :note="`This deletes both the generator setup and its generated playlist${deleteTarget?.trackCount ? ` (${deleteTarget.trackCount} tracks)` : ''} — not just the setup.`"
      confirm-label="Remove"
      variant="danger"
      :icon="LucideTrash2"
      @update:model-value="deleteTarget = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
