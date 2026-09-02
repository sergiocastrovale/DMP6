<script setup lang="ts">
import { Archive, AlertTriangle, CircleAlert, Trash2, Undo2 } from 'lucide-vue-next'
import type { MonitorEventItem } from '~/types/download'
import { timeAgo } from '~/helpers/functions'
import { cx, data, toneText, typography } from '~/helpers/ui'

const { counts, fetchEvents, archive, restore, remove } = useMonitorEvents()
const toast = useToastStore()
const { hasPerm } = useAuth()

const canEdit = hasPerm('downloads.crud')

const sub = ref<'flagged' | 'archived'>('flagged')
const search = ref('')
const items = ref<MonitorEventItem[]>([])
const loading = ref(false)
const busy = ref(false)
const confirmDeleteAll = ref(false)
const confirmDeleteId = ref<string | null>(null)

// 500 is the endpoint's cap. "Clear shown" archives the ids actually loaded, so loading the full list
// is what keeps the button's count honest.
const LIMIT = 500

const load = async () => {
  loading.value = true
  try {
    items.value = await fetchEvents({ archived: sub.value === 'archived', limit: LIMIT })
  }
  catch { items.value = [] }
  finally { loading.value = false }
}

watch(sub, load)
onMounted(load)

const tabs = computed(() => [
  { key: 'flagged', label: 'Flagged', count: counts.value.flagged },
  { key: 'archived', label: 'Archived', count: counts.value.archived },
])

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? items.value.filter(i => i.message.toLowerCase().includes(q) || i.level.includes(q)) : items.value
})

const visibleIds = computed(() => visible.value.map(i => i.id))

const run = async (action: () => Promise<number>, describe: (n: number) => string) => {
  busy.value = true
  try {
    const n = await action()
    toast.success(describe(n))
    await load()
  }
  catch (e: any) {
    toast.error(e?.data?.message || e?.message || 'Action failed')
  }
  finally { busy.value = false }
}

// No confirm: archiving is reversible from the Archived subtab, and confirming reversible actions
// trains people to click through the dialogs that do matter.
const clearShown = () => run(
  () => archive(visibleIds.value),
  n => `Cleared ${n} event${n === 1 ? '' : 's'}`,
)

const restoreOne = (id: string) => run(
  () => restore([id]),
  () => 'Moved back to flagged',
)

const deleteOne = () => {
  const id = confirmDeleteId.value
  confirmDeleteId.value = null
  if (!id) {
    return
  }
  run(() => remove([id]), () => 'Event deleted')
}

const deleteAllArchived = () => {
  confirmDeleteAll.value = false
  run(() => remove('allArchived'), n => `Deleted ${n} archived event${n === 1 ? '' : 's'}`)
}

const levelTone = (level: string) => (level === 'error' ? 'danger' : 'warning')
</script>

<template>
  <div class="flex flex-col gap-4">
    <DownloadsTabHint>
      Warnings and errors raised anywhere in the download pipeline — failed merges, stalled
      enrichment, sync hiccups — land here instead of only in the server logs. Flagged is what
      still needs a look; archive one once you've dealt with it.
    </DownloadsTabHint>

    <div class="flex items-center justify-between gap-4">
      <SearchInput v-model="search" placeholder="Search events…" />

      <UiButton
        v-if="canEdit && sub === 'flagged' && visible.length"
        size="sm"
        variant="danger"
        :icon="Archive"
        :loading="busy"
        title="Move the events shown below to Archived"
        @click="clearShown"
      >
        Clear {{ visible.length }} shown
      </UiButton>

      <UiButton
        v-else-if="canEdit && sub === 'archived' && items.length"
        size="sm"
        variant="danger"
        :icon="Trash2"
        :loading="busy"
        title="Permanently delete every archived event"
        @click="confirmDeleteAll = true"
      >
        Delete all archived
      </UiButton>
    </div>

    <Subtabs v-model="sub" :tabs="tabs" />

    <UiLoadingBlock v-if="loading" />

    <UiEmptyState
      v-else-if="!visible.length"
      :message="sub === 'flagged' ? 'No flagged events.' : 'Nothing archived.'"
      :hint="sub === 'flagged' ? 'The monitor loop logs warnings and errors here as they happen.' : 'Clearing a flagged event moves it here.'"
    />

    <!-- Not SlimTable: its `min-w-max` is right for the download queue's fixed-width columns, but a
         monitor message is long free text, so it would widen the table until the Logged column - the
         one you actually want - scrolled off the right edge. `w-full` lets the message wrap instead. -->
    <div v-else class="overflow-hidden rounded-xl border border-stone-100/6 bg-stone-900">
      <table class="w-full text-base">
        <SlimTableHeader>
          <th :class="cx(data.th, 'w-28 text-left')">Level</th>
          <th :class="cx(data.th, 'text-left')">Message</th>
          <th :class="cx(data.th, 'w-32 text-left')">Logged</th>
          <th v-if="canEdit && sub === 'archived'" :class="cx(data.th, 'w-24 text-right')">Actions</th>
        </SlimTableHeader>
        <SlimTableBody>
        <!-- A plain row, not SlimTableRow: its two states are `muted` (opacity-50, which would dim
             the message below the contrast floor) and the default (cursor-pointer + hover, which
             implies a click that does nothing here). A log row is neither. -->
        <tr v-for="ev in visible" :key="ev.id" class="border-b border-stone-100/6 last:border-b-0">
          <td :class="data.td">
            <span :class="cx('inline-flex items-center gap-1.5 whitespace-nowrap', toneText[levelTone(ev.level)])">
              <component :is="ev.level === 'error' ? CircleAlert : AlertTriangle" :size="13" />
              {{ ev.level }}
            </span>
          </td>
          <td :class="cx(data.td, 'text-stone-100/60')">
            <span class="break-words">{{ ev.message }}</span>
          </td>
          <td :class="cx(data.td, 'whitespace-nowrap', typography.meta)">
            {{ timeAgo(ev.createdAt) }}
          </td>
          <td v-if="canEdit && sub === 'archived'" :class="cx(data.td, 'text-right')" @click.stop>
            <div class="flex items-center justify-end gap-1">
              <DataTableAction
                :icon="Undo2"
                label="Move back to flagged"
                @click="restoreOne(ev.id)"
              />
              <DataTableAction
                :icon="Trash2"
                label="Delete permanently"
                @click="confirmDeleteId = ev.id"
              />
            </div>
          </td>
        </tr>
        </SlimTableBody>
      </table>
    </div>

    <ConfirmDialog
      v-model="confirmDeleteAll"
      title="Delete all archived events"
      :message="`Permanently delete ${counts.archived} archived event${counts.archived === 1 ? '' : 's'}?`"
      note="This cannot be undone. Flagged events are untouched."
      confirm-label="Delete"
      variant="danger"
      :icon="Trash2"
      @confirm="deleteAllArchived"
    />

    <ConfirmDialog
      :model-value="confirmDeleteId !== null"
      title="Delete event"
      message="Permanently delete this archived event?"
      note="This cannot be undone."
      confirm-label="Delete"
      variant="danger"
      :icon="Trash2"
      @update:model-value="(open: boolean) => { if (!open) { confirmDeleteId = null } }"
      @confirm="deleteOne"
    />
  </div>
</template>
