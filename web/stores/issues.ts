import { defineStore } from 'pinia'
import type { IssueSummary, IssueType } from '~/types/issues'
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

    try {
      const res = await $fetch<PaginatedResponse<any>>(`/api/issues/${type}`, {
        query: {
          page: currentPage,
          pageSize: 50,
          sort: sort.value[type],
          order: order.value[type] ?? 'asc',
          q: search.value[type] || undefined,
        },
      })
      items.value[type] = res.items
      total.value[type] = res.total
    } finally {
      pageLoading.value[type] = false
    }
  }

  async function fetchResolved(type: IssueType, reset = false) {
    if (reset) {
      resolvedPage.value[type] = 1
      resolvedItems.value[type] = []
    }
    const currentPage = resolvedPage.value[type] ?? 1
    resolvedLoading.value[type] = true

    try {
      const res = await $fetch<PaginatedResponse<any>>(`/api/issues/${type}`, {
        query: {
          page: currentPage,
          pageSize: 50,
          status: 'RESOLVED',
          sort: sort.value[type],
          order: order.value[type] ?? 'asc',
        },
      })
      resolvedItems.value[type] = res.items
      resolvedTotal.value[type] = res.total
    } finally {
      resolvedLoading.value[type] = false
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
    if (!list) return
    const idx = list.findIndex((i: any) => i.id === id)
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...body }
    }
  }

  return {
    summary, summaryLoading,
    items, total, page, pageLoading, sort, order, search,
    resolvedItems, resolvedTotal, resolvedPage, resolvedLoading,
    fetchSummary, fetchType, fetchResolved, setPage, setResolvedPage,
    setSort, setSearch, queueIds, queueRevert, patchIssue,
  }
})
