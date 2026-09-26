<script setup lang="ts">
import { useIssuesStore } from '~/stores/issues'
import { useTerminalStore } from '~/stores/terminal'
import type { IssueType } from '~/types/issues'
import {
  AUDIT_ONLY_ISSUE_TYPES, ISSUE_TYPE_DESCRIPTIONS, ISSUE_TYPE_LABELS, REVERTABLE_ISSUE_TYPES, issueColumns, resolvedIssueColumns,
} from '~/helpers/issueColumns'
import { cx, layout, typography } from '~/helpers/ui'

const props = defineProps<{ type: IssueType }>()

const PAGE_SIZE = 50

const issuesStore = useIssuesStore()
const terminal = useTerminalStore()
const { hasPerm } = useAuth()
const canFix = hasPerm('issues.fix')

const { selected, selectedResolved, fixSelected, revertSelected } = useIssueFixes(() => props.type)

const searchInput = ref('')
const activeSubtab = ref<'detected' | 'fixed'>('detected')

const isRevertable = computed(() => REVERTABLE_ISSUE_TYPES.includes(props.type))
const canSelectFixes = computed(() => canFix.value && !AUDIT_ONLY_ISSUE_TYPES.includes(props.type) && activeSubtab.value === 'detected')

const subtabs = computed(() => [
  { key: 'detected', label: 'Detected', count: issuesStore.total[props.type] ?? 0, activeColor: 'border-info' },
  { key: 'fixed', label: 'Fixed', count: issuesStore.resolvedTotal[props.type] ?? 0, activeColor: 'border-success' },
])

const columns = computed(() => issueColumns(props.type, canFix.value))
const resolvedColumns = computed(() => resolvedIssueColumns(props.type))

onMounted(() => {
  issuesStore.fetchSummary()
  issuesStore.fetchType(props.type, true)
  if (isRevertable.value) {
    issuesStore.fetchResolved(props.type, true)
  }
})

watch(searchInput, (q) => {
  issuesStore.setSearch(props.type, q)
})

const onEdit = async (id: string, key: string, value: unknown) => {
  await issuesStore.patchIssue(props.type, id, { [key]: value })
}
</script>

<template>
  <div :class="cx(layout.page)">
    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-4">
        <h1 :class="typography.h3">{{ ISSUE_TYPE_LABELS[type] }}</h1>
        <div class="flex items-center gap-2">
          <SearchInput
            v-model="searchInput"
            placeholder="Search..."
            :debounce="350"
          />
        </div>
      </div>
      <p class="text-base text-stone-100/55">
        {{ ISSUE_TYPE_DESCRIPTIONS[type].detection }}
        <span class="text-stone-100/25">Fix:</span> {{ ISSUE_TYPE_DESCRIPTIONS[type].fix }}
      </p>
    </div>

    <Subtabs v-if="isRevertable" v-model="activeSubtab" :tabs="subtabs" />

    <IssuesSelectionBar
      v-if="canSelectFixes"
      :count="selected.size"
      :type="type"
      :loading="terminal.isRunning"
      @fix="fixSelected"
      @cancel="selected = new Set()"
    />

    <IssuesRevertSelectionBar
      v-if="canFix && isRevertable && activeSubtab === 'fixed'"
      :count="selectedResolved.size"
      :loading="terminal.isRunning"
      @revert="revertSelected"
      @cancel="selectedResolved = new Set()"
    />

    <IssuesDetectedTable
      v-if="activeSubtab === 'detected'"
      v-model:selected="selected"
      :type="type"
      :columns="columns"
      :items="issuesStore.items[type] ?? []"
      :total="issuesStore.total[type] ?? 0"
      :page="issuesStore.page[type] ?? 1"
      :page-size="PAGE_SIZE"
      :loading="issuesStore.pageLoading[type] ?? false"
      :sort="issuesStore.sort[type]"
      :order="issuesStore.order[type]"
      :selectable="canFix"
      @sort="issuesStore.setSort(type, $event)"
      @page="issuesStore.setPage(type, $event)"
      @edit="onEdit"
    />

    <IssuesResolvedTable
      v-if="activeSubtab === 'fixed' && isRevertable"
      v-model:selected="selectedResolved"
      :type="type"
      :columns="resolvedColumns"
      :items="issuesStore.resolvedItems[type] ?? []"
      :total="issuesStore.resolvedTotal[type] ?? 0"
      :page="issuesStore.resolvedPage[type] ?? 1"
      :page-size="PAGE_SIZE"
      :loading="issuesStore.resolvedLoading[type] ?? false"
      :selectable="canFix"
      @page="issuesStore.setResolvedPage(type, $event)"
    />
  </div>
</template>
