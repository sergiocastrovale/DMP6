import { defineStore } from 'pinia'
import type { FixHistoryRow, HistoryIssueType, IssueSummary, IssueType } from '~/types/issues'
import type { PaginatedResponse } from '~/types/api'

export const useIssuesStore = defineStore('issues', () => {
  const summary = ref<IssueSummary | null>(null)
  const summaryLoading = ref(false)

  const items = ref<Record<string, any[]>>({})
  const total = ref<Record<string, number>>({})
  const page = ref<Record<string, number>>({})
  const pageLoading = ref<Record<string, boolean>>({})
  const sort = ref<Record<string, string>>({})
  const order = ref<Record<string, 'asc' | 'desc'>>({})
  const search = ref<Record<string, string>>({})

  const resolvedItems = ref<Record<string, any[]>>({})
  const resolvedTotal = ref<Record<string, number>>({})
  const resolvedPage = ref<Record<string, number>>({})
  const resolvedLoading = ref<Record<string, boolean>>({})

  // Per-type abort controllers: rapid setSort/setSearch/setPage calls for the SAME type must not let
  // a stale response land after a fresher one; different types are independent and never cancel
  // each other.
  const typeAbortControllers: Record<string, AbortController> = {}
  const resolvedAbortControllers: Record<string, AbortController> = {}

  async function fetchSummary() {
    summaryLoading.value = true
    try {
      summary.value = await $fetch<IssueSummary>('/api/issues/summary')
    } finally {
      summaryLoading.value = false
    }
  }

  async function fetchType(type: IssueType, reset = false) {
    if (reset) {
      page.value[type] = 1
      items.value[type] = []
    }
    const currentPage = page.value[type] ?? 1
    pageLoading.value[type] = true

    typeAbortControllers[type]?.abort()
    const controller = new AbortController()
    typeAbortControllers[type] = controller

    try {
      const res = await $fetch<PaginatedResponse<any>>(`/api/issues/${type}`, {
        query: {
          page: currentPage,
          pageSize: 50,
          sort: sort.value[type],
          order: order.value[type] ?? 'asc',
          q: search.value[type] || undefined,
        },
        signal: controller.signal,
      })
      if (controller.signal.aborted) {return}
      items.value[type] = res.items
      total.value[type] = res.total
    }
    catch (e: any) {
      if (e?.name !== 'AbortError') {throw e}
    }
    finally {
      if (typeAbortControllers[type] === controller) {
        pageLoading.value[type] = false
      }
    }
  }

  async function fetchResolved(type: IssueType, reset = false) {
    if (reset) {
      resolvedPage.value[type] = 1
      resolvedItems.value[type] = []
    }
    const currentPage = resolvedPage.value[type] ?? 1
    resolvedLoading.value[type] = true

    resolvedAbortControllers[type]?.abort()
    const controller = new AbortController()
    resolvedAbortControllers[type] = controller

    try {
      const res = await $fetch<PaginatedResponse<any>>(`/api/issues/${type}`, {
        query: {
          page: currentPage,
          pageSize: 50,
          status: 'RESOLVED',
          sort: sort.value[type],
          order: order.value[type] ?? 'asc',
        },
        signal: controller.signal,
      })
      if (controller.signal.aborted) {return}
      resolvedItems.value[type] = res.items
      resolvedTotal.value[type] = res.total
    }
    catch (e: any) {
      if (e?.name !== 'AbortError') {throw e}
    }
    finally {
      if (resolvedAbortControllers[type] === controller) {
        resolvedLoading.value[type] = false
      }
    }
  }

  async function setPage(type: IssueType, p: number) {
    page.value[type] = p
    await fetchType(type)
  }

  async function setResolvedPage(type: IssueType, p: number) {
    resolvedPage.value[type] = p
    await fetchResolved(type)
  }

  async function setSort(type: IssueType, key: string) {
    if (sort.value[type] === key) {
      order.value[type] = order.value[type] === 'asc' ? 'desc' : 'asc'
    } else {
      sort.value[type] = key
      order.value[type] = 'asc'
    }
    page.value[type] = 1
    await fetchType(type)
  }

  async function setSearch(type: IssueType, q: string) {
    search.value[type] = q
    page.value[type] = 1
    await fetchType(type)
  }

  async function queueIds(type: IssueType, ids: string[]) {
    const res = await $fetch<{ queued: number }>(`/api/issues/${type}/queue`, {
      method: 'POST',
      body: { ids },
    })
    return res.queued
  }

  async function queueRevert(type: IssueType, ids: string[], mode: 'undo' | 'undo-resolved') {
    const res = await $fetch<{ queued: number; mode: string }>(`/api/issues/${type}/queue-revert`, {
      method: 'POST',
      body: { ids, mode },
    })
    return res.queued
  }

  async function patchIssue(type: IssueType, id: string, body: Record<string, unknown>) {
    await $fetch(`/api/issues/${type}/${id}`, { method: 'PATCH', body })
    const list = items.value[type]
    if (!list) {return}
    const idx = list.findIndex((i: any) => i.id === id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...body }
    }
  }

  const historyItems = ref<Record<string, FixHistoryRow[]>>({})
  const historyTotal = ref<Record<string, number>>({})
  const historyPage = ref<Record<string, number>>({})
  const historyLoading = ref<Record<string, boolean>>({})
  const historyCounts = ref<{ corrupted: number; missing: number }>({ corrupted: 0, missing: 0 })

  async function fetchHistoryCounts() {
    const res = await $fetch<{ counts: typeof historyCounts.value; total: number }>('/api/issues/history', { query: { mode: 'counts' } })
    historyCounts.value = res.counts
  }

  async function fetchHistory(type: HistoryIssueType, reset = false) {
    if (reset) {
      historyPage.value[type] = 1
      historyItems.value[type] = []
    }
    const currentPage = historyPage.value[type] ?? 1
    historyLoading.value[type] = true

    try {
      const res = await $fetch<PaginatedResponse<FixHistoryRow>>('/api/issues/history', {
        query: { type, page: currentPage, pageSize: 50 },
      })
      historyItems.value[type] = res.items
      historyTotal.value[type] = res.total
    } finally {
      historyLoading.value[type] = false
    }
  }

  async function setHistoryPage(type: HistoryIssueType, p: number) {
    historyPage.value[type] = p
    await fetchHistory(type)
  }

  async function clearHistoryItems(ids: string[]) {
    await $fetch('/api/issues/history', { method: 'DELETE', body: { ids } })
  }

  async function undoHistoryItems(ids: string[]) {
    const res = await $fetch<{ queued: Record<string, number> }>('/api/issues/history-undo', {
      method: 'POST',
      body: { ids },
    })
    return res.queued
  }

  return {
    summary, summaryLoading,
    items, total, page, pageLoading, sort, order, search,
    resolvedItems, resolvedTotal, resolvedPage, resolvedLoading,
    historyItems, historyTotal, historyPage, historyLoading, historyCounts,
    fetchSummary, fetchType, fetchResolved, setPage, setResolvedPage,
    setSort, setSearch, queueIds, queueRevert, patchIssue,
    fetchHistoryCounts, fetchHistory, setHistoryPage, clearHistoryItems, undoHistoryItems,
  }
})
