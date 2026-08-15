<script setup lang="ts">
import { FileText } from 'lucide-vue-next'
import { useIssuesStore } from '~/stores/issues'
import { useTerminalStore } from '~/stores/terminal'
import type { FixHistoryRow, HistoryIssueType } from '~/types/issues'

const issuesStore = useIssuesStore()
const terminal = useTerminalStore()

const TABS: { key: HistoryIssueType; label: string }[] = [
  { key: 'corrupted', label: 'Corrupted TPE2' },
  { key: 'missing', label: 'Missing Metadata' },
]

const activeTab = ref<HistoryIssueType>('corrupted')
const selected = ref<Set<string>>(new Set())
const dialogFolder = ref<string | null>(null)

interface FolderGroup {
  folder: string
  items: FixHistoryRow[]
  ids: string[]
}

const groups = computed<FolderGroup[]>(() => {
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

function isGroupChecked(g: FolderGroup): boolean {
  return g.ids.every((id) => selected.value.has(id))
}

function isGroupPartial(g: FolderGroup): boolean {
  const count = g.ids.filter((id) => selected.value.has(id)).length
  return count > 0 && count < g.ids.length
}

function selectedInGroup(g: FolderGroup): number {
  return g.ids.filter((id) => selected.value.has(id)).length
}

function toggleGroup(g: FolderGroup) {
  const next = new Set(selected.value)
  if (isGroupChecked(g)) {
    for (const id of g.ids) {
      next.delete(id)
    }
  } else {
    for (const id of g.ids) {
      next.add(id)
    }
  }
  selected.value = next
}

function toggleFile(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selected.value = next
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

    <div class="flex items-center gap-1 border-b border-rule">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        type="button"
        class="-mb-px flex items-center gap-2 px-3 py-2 text-sm font-medium transition-colors"
        :class="activeTab === tab.key
          ? 'border-b-2 border-accent text-ink'
          : 'border-b-2 border-transparent text-ink-2 hover:text-ink'"
        @click="activeTab = tab.key"
      >
        <span>{{ tab.label }}</span>
        <span
          class="inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          :class="(issuesStore.historyCounts[tab.key] ?? 0) > 0
            ? 'bg-accent-soft text-accent'
            : 'bg-bg-2 text-ink-3'"
        >
          {{ issuesStore.historyCounts[tab.key] ?? 0 }}
        </span>
      </button>
    </div>

    <div class="rounded-lg border border-rule bg-bg">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-rule text-left">
              <th class="w-10 px-3 py-2">
                <input type="checkbox" :checked="allChecked" class="rounded border-rule bg-bg-2" @change="toggleAll" >
              </th>
              <th class="px-3 py-2 text-xs font-medium text-ink-3">Folder</th>
              <th class="px-3 py-2 text-xs font-medium text-ink-3">Previous</th>
              <th class="px-3 py-2 text-xs font-medium text-ink-3">Applied</th>
              <th class="w-32 px-3 py-2 text-xs font-medium text-ink-3">Applied At</th>
            </tr>
          </thead>
          <tbody>
            <template v-if="issuesStore.historyLoading[activeTab] && groups.length === 0">
              <tr v-for="n in 5" :key="n" class="border-b border-rule/50">
                <td class="px-3 py-2.5"><div class="h-4 w-4 animate-pulse rounded bg-bg-2" /></td>
                <td v-for="c in 4" :key="c" class="px-3 py-2.5"><div class="h-4 w-32 animate-pulse rounded bg-bg-2" /></td>
              </tr>
            </template>

            <tr v-else-if="!issuesStore.historyLoading[activeTab] && groups.length === 0">
              <td colspan="5" class="px-3 py-12 text-center text-ink-3">No history records</td>
            </tr>

            <tr
              v-for="g in groups"
              :key="g.folder"
              class="border-b border-rule/50 transition-colors hover:bg-bg-1/30"
              :class="isGroupChecked(g) ? 'bg-blue-950/20' : ''"
            >
              <td class="px-3 py-2">
                <input
                  type="checkbox"
                  :checked="isGroupChecked(g)"
                  :indeterminate="isGroupPartial(g)"
                  class="rounded border-rule bg-bg-2"
                  @change="toggleGroup(g)"
                >
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-col gap-1">
                  <span class="truncate text-xs text-ink-2" :title="g.folder">{{ g.folder }}</span>
                  <button
                    class="flex w-fit items-center gap-1.5 rounded-full bg-bg-2 px-2 py-0.5 text-[11px] transition-colors hover:bg-bg-3"
                    @click="dialogFolder = g.folder"
                  >
                    <FileText :size="11" class="text-ink-2" />
                    <span class="text-ink-2">{{ g.items.length }} file{{ g.items.length !== 1 ? 's' : '' }}</span>
                    <span v-if="selectedInGroup(g) > 0" class="text-blue-400">/ {{ selectedInGroup(g) }} selected</span>
                  </button>
                </div>
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-col gap-0.5">
                  <span v-for="e in getStateEntries(g.items[0]!.previousState, Object.keys(g.items[0]!.appliedState ?? {}))" :key="e.key" class="text-xs text-accent">
                    <span class="text-ink-3">{{ e.key }}:</span> {{ e.value }}
                  </span>
                  <span v-if="!getStateEntries(g.items[0]!.previousState, Object.keys(g.items[0]!.appliedState ?? {})).length" class="text-xs text-ink-4">-</span>
                </div>
              </td>
              <td class="px-3 py-2">
                <div class="flex flex-col gap-0.5">
                  <span v-for="e in getStateEntries(g.items[0]!.appliedState)" :key="e.key" class="text-xs text-green-400">
                    <span class="text-ink-3">{{ e.key }}:</span> {{ e.value }}
                  </span>
                  <span v-if="!getStateEntries(g.items[0]!.appliedState).length" class="text-xs text-ink-4">-</span>
                </div>
              </td>
              <td class="px-3 py-2">
                <span class="text-xs text-ink-3">{{ formatDate(g.items[0]!.appliedAt) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div
        v-if="(issuesStore.historyTotal[activeTab] ?? 0) > 50"
        class="flex items-center justify-between border-t border-rule px-4 py-2 text-xs text-ink-3"
      >
        <span>{{ issuesStore.historyTotal[activeTab] }} total</span>
        <div class="flex items-center gap-2">
          <button
            :disabled="(issuesStore.historyPage[activeTab] ?? 1) <= 1"
            class="rounded px-2 py-1 hover:bg-bg-2 disabled:opacity-40"
            @click="issuesStore.setHistoryPage(activeTab, (issuesStore.historyPage[activeTab] ?? 1) - 1)"
          >Prev</button>
          <span>{{ issuesStore.historyPage[activeTab] ?? 1 }} / {{ Math.ceil((issuesStore.historyTotal[activeTab] ?? 0) / 50) }}</span>
          <button
            :disabled="(issuesStore.historyPage[activeTab] ?? 1) >= Math.ceil((issuesStore.historyTotal[activeTab] ?? 0) / 50)"
            class="rounded px-2 py-1 hover:bg-bg-2 disabled:opacity-40"
            @click="issuesStore.setHistoryPage(activeTab, (issuesStore.historyPage[activeTab] ?? 1) + 1)"
          >Next</button>
        </div>
      </div>
    </div>

    <Dialog :model-value="dialogFolder !== null" :title="dialogGroup?.folder ?? ''" max-width="lg" @update:model-value="!$event && (dialogFolder = null)">
      <div v-if="dialogGroup" class="flex flex-col gap-0">
        <div
          v-for="item in dialogGroup.items"
          :key="item.id"
          class="flex items-center gap-3 border-b border-rule/50 px-1 py-2 last:border-0"
          :class="selected.has(item.id) ? 'bg-blue-950/20' : ''"
        >
          <input
            type="checkbox"
            :checked="selected.has(item.id)"
            class="rounded border-rule bg-bg-2"
            @change="toggleFile(item.id)"
          >
          <span class="flex-1 truncate text-xs text-ink-2" :title="item.filePath">{{ fileName(item.filePath) }}</span>
          <div class="flex flex-col gap-0.5">
            <span v-for="e in getStateEntries(item.appliedState)" :key="e.key" class="text-[11px] text-green-400">
              <span class="text-ink-3">{{ e.key }}:</span> {{ e.value }}
            </span>
          </div>
        </div>
      </div>
    </Dialog>

    <IssuesHistorySelectionBar
      :count="selected.size"
      :loading="terminal.isRunning"
      @clear="clearSelected"
      @undo="undoSelected"
    />
  </div>
</template>
