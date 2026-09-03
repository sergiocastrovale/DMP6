<script setup lang="ts">
import { FileText } from 'lucide-vue-next'
import { useIssuesStore } from '~/stores/issues'
import { useTerminalStore } from '~/stores/terminal'
import type { FixHistoryRow, HistoryIssueType, HistoryFolderGroup } from '~/types/issues'
import { cx, data } from '~/helpers/ui'
import { toggleRowSelection } from '~/helpers/functions'

const issuesStore = useIssuesStore()
const terminal = useTerminalStore()

const TABS: { key: HistoryIssueType; label: string }[] = [
  { key: 'corrupted', label: 'Corrupted TPE2' },
  { key: 'missing', label: 'Missing Metadata' },
]

const subtabs = computed(() => TABS.map(t => ({ ...t, count: issuesStore.historyCounts[t.key] ?? 0 })))

const activeTab = ref<HistoryIssueType>('corrupted')
const selected = ref<Set<string>>(new Set())
const dialogFolder = ref<string | null>(null)

const groups = computed<HistoryFolderGroup[]>(() => {
  const raw = issuesStore.historyItems[activeTab.value] ?? []
  const map = new Map<string, FixHistoryRow[]>()
  for (const item of raw) {
    const folder = item.filePath.replace(/\/[^/]+$/, '')
    const list = map.get(folder)
    if (list) {
      list.push(item)
    } else {
      map.set(folder, [item])
    }
  }
  return [...map.entries()].map(([folder, items]) => ({
    folder,
    items,
    ids: items.map((i) => i.id),
  }))
})

const allChecked = computed(() =>
  groups.value.length > 0 && groups.value.every((g) => g.ids.every((id) => selected.value.has(id)))
)

function toggleAll() {
  const next = new Set(selected.value)
  if (allChecked.value) {
    for (const g of groups.value) {
      for (const id of g.ids) {
        next.delete(id)
      }
    }
  } else {
    for (const g of groups.value) {
      for (const id of g.ids) {
        next.add(id)
      }
    }
  }
  selected.value = next
}

function isGroupChecked(g: HistoryFolderGroup): boolean {
  return g.ids.every((id) => selected.value.has(id))
}

function isGroupPartial(g: HistoryFolderGroup): boolean {
  const count = g.ids.filter((id) => selected.value.has(id)).length
  return count > 0 && count < g.ids.length
}

function selectedInGroup(g: HistoryFolderGroup): number {
  return g.ids.filter((id) => selected.value.has(id)).length
}

const groupAnchor = ref<string | null>(null)
let pendingGroupShiftKey = false

function captureGroupClick(event: MouseEvent) {
  pendingGroupShiftKey = event.shiftKey
}

function toggleGroup(g: HistoryFolderGroup) {
  const folders = groups.value.map((gr) => gr.folder)
  const wasChecked = isGroupChecked(g)
  const next = new Set(selected.value)
  const applyGroup = (folder: string, select: boolean) => {
    const target = groups.value.find((gr) => gr.folder === folder)
    if (!target) {
      return
    }
    for (const id of target.ids) {
      select ? next.add(id) : next.delete(id)
    }
  }
  const from = pendingGroupShiftKey && groupAnchor.value !== null ? folders.indexOf(groupAnchor.value) : -1
  const to = folders.indexOf(g.folder)
  if (from !== -1 && to !== -1) {
    const [start, end] = from < to ? [from, to] : [to, from]
    for (let i = start; i <= end; i++) {
      applyGroup(folders[i]!, true)
    }
  } else {
    applyGroup(g.folder, !wasChecked)
  }
  groupAnchor.value = g.folder
  pendingGroupShiftKey = false
  selected.value = next
}

const fileAnchor = ref<string | null>(null)
let pendingFileShiftKey = false

function captureFileClick(event: MouseEvent) {
  pendingFileShiftKey = event.shiftKey
}

function toggleFile(id: string) {
  const ids = dialogGroup.value?.items.map((item) => item.id) ?? [id]
  selected.value = toggleRowSelection(ids, selected.value, id, { shiftKey: pendingFileShiftKey }, fileAnchor.value)
  fileAnchor.value = id
  pendingFileShiftKey = false
}

const dialogGroup = computed(() =>
  dialogFolder.value ? groups.value.find((g) => g.folder === dialogFolder.value) ?? null : null
)

const getStateEntries = (state: Record<string, unknown> | null, filterKeys?: string[]): { key: string; value: string }[] => {
  if (!state) {
    return []
  }
  return Object.entries(state)
    .filter(([k, v]) => v != null && v !== '' && (!filterKeys || filterKeys.includes(k)))
    .map(([k, v]) => ({ key: k, value: String(v) }))
}

const formatDate = (date: string): string =>
  new Date(date).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

const fileName = (fp: string): string => fp.split('/').pop() ?? fp

onMounted(async () => {
  await issuesStore.fetchHistoryCounts()
  const first = TABS.find((t) => (issuesStore.historyCounts[t.key] ?? 0) > 0)
  if (first) {
    activeTab.value = first.key
  }
  await issuesStore.fetchHistory(activeTab.value, true)
})

watch(activeTab, (tab) => {
  selected.value = new Set()
  issuesStore.fetchHistory(tab, true)
})

watch(() => terminal.exitCode, (code) => {
  if (code === 0) {
    issuesStore.fetchHistory(activeTab.value, true)
    issuesStore.fetchHistoryCounts()
  }
})

async function clearSelected() {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }
  await issuesStore.clearHistoryItems(ids)
  selected.value = new Set()
  dialogFolder.value = null
  await Promise.all([
    issuesStore.fetchHistory(activeTab.value, true),
    issuesStore.fetchHistoryCounts(),
  ])
}

async function undoSelected() {
  const ids = [...selected.value]
  if (!ids.length) {
    return
  }
  const queued = await issuesStore.undoHistoryItems(ids)
  selected.value = new Set()
  dialogFolder.value = null

  const types = Object.keys(queued).filter((t) => (queued[t] ?? 0) > 0) as HistoryIssueType[]
  if (types.length === 0) {
    return
  }

  terminal.run('./fix', ['--revert', ...types.map((t) => `--${t}`), '--mode=undo'], 'fix')
  terminal.open()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <PageTitle text="Fix History" />

    <Subtabs v-model="activeTab" :tabs="subtabs" />

    <IssuesHistorySelectionBar
      :count="selected.size"
      :loading="terminal.isRunning"
      @clear="clearSelected"
      @undo="undoSelected"
      @cancel="selected = new Set()"
    />

    <div class="flex flex-col gap-0">
      <SlimTable>
        <SlimTableHeader>
          <th :class="cx(data.th, 'w-10')">
            <UiCheckbox :model-value="allChecked" aria-label="Select all folders" @update:model-value="toggleAll" />
          </th>
          <th :class="cx(data.th, 'text-left')">Folder</th>
          <th :class="cx(data.th, 'text-left')">Previous</th>
          <th :class="cx(data.th, 'text-left')">Applied</th>
          <th :class="cx(data.th, 'w-32 text-left')">Applied At</th>
        </SlimTableHeader>
        <SlimTableBody>
          <template v-if="issuesStore.historyLoading[activeTab] && groups.length === 0">
            <tr v-for="n in 5" :key="n" class="border-b border-stone-100/6 last:border-b-0">
              <td :class="data.td"><UiSkeleton w="size-4" h="" /></td>
              <td v-for="c in 4" :key="c" :class="data.td"><UiSkeleton w="w-32" /></td>
            </tr>
          </template>

          <tr v-else-if="!issuesStore.historyLoading[activeTab] && groups.length === 0">
            <td colspan="5">
              <UiEmptyState message="No history records" />
            </td>
          </tr>

          <SlimTableRow
            v-for="g in groups"
            :key="g.folder"
            :active="isGroupChecked(g)"
          >
            <td :class="data.td" @click.stop="captureGroupClick">
              <UiCheckbox
                :model-value="isGroupChecked(g)"
                :indeterminate="isGroupPartial(g)"
                :aria-label="`Select all files in ${g.folder}`"
                @update:model-value="toggleGroup(g)"
              />
            </td>
            <td :class="data.td">
              <div class="flex flex-col gap-1">
                <span class="truncate text-xs text-stone-100/60" :title="g.folder">{{ g.folder }}</span>
                <button
                  type="button"
                  class="flex w-fit items-center gap-1.5 rounded-full bg-stone-800 px-2 py-0.5 text-[11px] transition-colors duration-150 hover:bg-stone-700"
                  @click.stop="dialogFolder = g.folder"
                >
                  <FileText :size="11" class="text-stone-100/60" />
                  <span class="text-stone-100/60">{{ g.items.length }} file{{ g.items.length !== 1 ? 's' : '' }}</span>
                  <span v-if="selectedInGroup(g) > 0" class="text-amber-400">/ {{ selectedInGroup(g) }} selected</span>
                </button>
              </div>
            </td>
            <td :class="data.td">
              <div class="flex flex-col gap-0.5">
                <span v-for="e in getStateEntries(g.items[0]!.previousState, Object.keys(g.items[0]!.appliedState ?? {}))" :key="e.key" class="text-xs text-amber-400">
                  <span class="text-stone-100/55">{{ e.key }}:</span> {{ e.value }}
                </span>
                <span v-if="!getStateEntries(g.items[0]!.previousState, Object.keys(g.items[0]!.appliedState ?? {})).length" class="text-xs text-stone-100/20">-</span>
              </div>
            </td>
            <td :class="data.td">
              <div class="flex flex-col gap-0.5">
                <span v-for="e in getStateEntries(g.items[0]!.appliedState)" :key="e.key" class="text-xs text-success">
                  <span class="text-stone-100/55">{{ e.key }}:</span> {{ e.value }}
                </span>
                <span v-if="!getStateEntries(g.items[0]!.appliedState).length" class="text-xs text-stone-100/20">-</span>
              </div>
            </td>
            <td :class="data.td">
              <span class="text-xs text-stone-100/55">{{ formatDate(g.items[0]!.appliedAt) }}</span>
            </td>
          </SlimTableRow>
        </SlimTableBody>
      </SlimTable>

      <div
        v-if="(issuesStore.historyTotal[activeTab] ?? 0) > 50"
        class="flex items-center justify-between border-t border-stone-100/6 px-4 py-2.5 text-sm text-stone-100/55"
      >
        <span class="tabular-nums">{{ issuesStore.historyTotal[activeTab] }} total</span>
        <div class="flex items-center gap-2">
          <UiButton
            variant="ghost"
            size="sm"
            :disabled="(issuesStore.historyPage[activeTab] ?? 1) <= 1"
            @click="issuesStore.setHistoryPage(activeTab, (issuesStore.historyPage[activeTab] ?? 1) - 1)"
          >Prev</UiButton>
          <span class="tabular-nums">{{ issuesStore.historyPage[activeTab] ?? 1 }} / {{ Math.ceil((issuesStore.historyTotal[activeTab] ?? 0) / 50) }}</span>
          <UiButton
            variant="ghost"
            size="sm"
            :disabled="(issuesStore.historyPage[activeTab] ?? 1) >= Math.ceil((issuesStore.historyTotal[activeTab] ?? 0) / 50)"
            @click="issuesStore.setHistoryPage(activeTab, (issuesStore.historyPage[activeTab] ?? 1) + 1)"
          >Next</UiButton>
        </div>
      </div>
    </div>

    <Dialog :model-value="dialogFolder !== null" :title="dialogGroup?.folder ?? ''" size="lg" @update:model-value="!$event && (dialogFolder = null)">
      <template #content>
        <div v-if="dialogGroup" class="flex flex-col gap-0">
          <div
            v-for="item in dialogGroup.items"
            :key="item.id"
            class="flex items-center gap-3 border-b border-stone-100/6 px-1 py-2 last:border-0"
            :class="selected.has(item.id) ? 'bg-amber-400/10' : ''"
            @click.stop="captureFileClick"
          >
            <UiCheckbox
              :model-value="selected.has(item.id)"
              :aria-label="`Select ${fileName(item.filePath)}`"
              @update:model-value="toggleFile(item.id)"
            />
            <span class="flex-1 truncate text-xs text-stone-100/60" :title="item.filePath">{{ fileName(item.filePath) }}</span>
            <div class="flex flex-col gap-0.5">
              <span v-for="e in getStateEntries(item.appliedState)" :key="e.key" class="text-[11px] text-success">
                <span class="text-stone-100/55">{{ e.key }}:</span> {{ e.value }}
              </span>
            </div>
          </div>
        </div>
      </template>
    </Dialog>
  </div>
</template>
