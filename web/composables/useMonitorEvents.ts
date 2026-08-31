export interface MonitorEventItem {
  id: string
  level: 'warn' | 'error'
  message: string
  createdAt: string
  archivedAt: string | null
}

interface MonitorEventCounts {
  flagged: number
  archived: number
}

interface MonitorEventsResponse {
  items: MonitorEventItem[]
  counts: MonitorEventCounts
}

// Monitor issues, shared across the three surfaces that show them: the Downloads shell's tab badge,
// the Events tab itself, and the "Recent issues" panel. The counts live in `useState` so all three
// agree the moment anything is archived - previously each surface would have fetched its own and the
// badge would sit stale until a reload.
//
// `items` is deliberately NOT shared: the panel wants flagged-only at limit 50 while the Events tab
// wants either list at a much higher limit, so one shared array would have them fighting over it.
export const useMonitorEvents = () => {
  const counts = useState<MonitorEventCounts>('monitor-event-counts', () => ({ flagged: 0, archived: 0 }))

  const fetchEvents = async (options: { archived?: boolean, limit?: number } = {}) => {
    const data = await $fetch<MonitorEventsResponse>('/api/downloads/monitor-events', {
      query: { archived: options.archived ? 'true' : 'false', limit: options.limit ?? 50 },
    })
    counts.value = data.counts
    return data.items
  }

  // Cheapest possible counts-only read: limit 1 still returns the full totals.
  const refreshCounts = async () => {
    try {
      const data = await $fetch<MonitorEventsResponse>('/api/downloads/monitor-events', { query: { limit: 1 } })
      counts.value = data.counts
    }
    catch { /* the badge staying stale is not worth surfacing an error for */ }
  }

  const archive = async (ids: string[]) => {
    if (!ids.length) {
      return 0
    }
    const { archived } = await $fetch<{ archived: number }>('/api/downloads/monitor-events/archive', {
      method: 'POST',
      body: { ids },
    })
    await refreshCounts()
    return archived
  }

  const restore = async (ids: string[]) => {
    if (!ids.length) {
      return 0
    }
    const { restored } = await $fetch<{ restored: number }>('/api/downloads/monitor-events/restore', {
      method: 'POST',
      body: { ids },
    })
    await refreshCounts()
    return restored
  }

  // `'allArchived'` rather than an ids array empties the whole Archived list server-side, so the
  // client never has to hold every id just to delete them.
  const remove = async (target: string[] | 'allArchived') => {
    const body = target === 'allArchived' ? { allArchived: true } : { ids: target }
    if (target !== 'allArchived' && target.length === 0) {
      return 0
    }
    const { deleted } = await $fetch<{ deleted: number }>('/api/downloads/monitor-events/delete', {
      method: 'POST',
      body,
    })
    await refreshCounts()
    return deleted
  }

  return { counts, fetchEvents, refreshCounts, archive, restore, remove }
}
