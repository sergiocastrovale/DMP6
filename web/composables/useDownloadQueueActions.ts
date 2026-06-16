import { storeToRefs } from 'pinia'
import type { DownloadedReleaseItem } from '~/types/download'
import type { UnifiedRelease } from '~/types/release'

// Shared handlers + dialog state for the per-tab download queue pages.
// Thin wrappers over the downloads store so content components stay slim.
export const useDownloadQueueActions = () => {
  const store = useDownloadsStore()
  const { queueActive, queueReady, queueHistory } = storeToRefs(store)

  const busyId = ref<string | null>(null)
  const busyIds = ref<Set<string>>(new Set())
  const actionMsg = ref<string | null>(null)

  const run = async (id: string, fn: () => Promise<unknown>, failMsg: string) => {
    busyId.value = id
    try {
      await fn()
    }
    catch (e: any) {
      actionMsg.value = e?.data?.message || e?.message || failMsg
    }
    finally {
      busyId.value = null
    }
  }

  // Concurrent variant (merge only) — multiple ids can be in flight at once.
  const runConcurrent = async (id: string, fn: () => Promise<unknown>, failMsg: string) => {
    busyIds.value = new Set(busyIds.value).add(id)
    try {
      await fn()
    }
    catch (e: any) {
      actionMsg.value = e?.data?.message || e?.message || failMsg
    }
    finally {
      const next = new Set(busyIds.value)
      next.delete(id)
      busyIds.value = next
    }
  }

  const retry = (id: string) => run(id, () => store.retry(id), 'Retry failed')
  const merge = (id: string) => runConcurrent(id, () => store.merge(id), 'Merge failed')
  const mergeMany = (ids: string[]) => Promise.all(ids.map(id => merge(id)))

  const findItem = (id: string | null) =>
    queueActive.value.find(i => i.id === id)
    ?? queueReady.value.find(i => i.id === id)
    ?? queueHistory.value.find(i => i.id === id)
    ?? null

  // Reject dialog
  const rejectId = ref<string | null>(null)
  const rejectOpen = ref(false)
  const rejectTitle = computed(() => findItem(rejectId.value)?.title ?? null)
  const reject = (id: string) => {
    rejectId.value = id
    rejectOpen.value = true
  }
  const confirmReject = async () => {
    const id = rejectId.value
    rejectOpen.value = false
    rejectId.value = null
    if (!id) {
      return
    }
    await run(id, () => store.reject(id), 'Reject failed')
  }

  // Cancel dialog
  const cancelId = ref<string | null>(null)
  const cancelOpen = ref(false)
  const cancelTitle = computed(() => findItem(cancelId.value)?.title ?? null)
  const cancel = (id: string) => {
    cancelId.value = id
    cancelOpen.value = true
  }
  const confirmCancel = async () => {
    const id = cancelId.value
    cancelOpen.value = false
    cancelId.value = null
    if (!id) {
      return
    }
    await run(id, () => store.cancel(id), 'Cancel failed')
  }

  // Info dialog (maps a download row to a partial UnifiedRelease for ArtistReleaseInfoDialog)
  const infoItem = ref<DownloadedReleaseItem | null>(null)
  const showInfo = ref(false)
  const openInfo = (id: string) => {
    infoItem.value = findItem(id)
    if (infoItem.value) {
      showInfo.value = true
    }
  }
  const infoRelease = computed<UnifiedRelease | null>(() => {
    const it = infoItem.value
    if (!it) {
      return null
    }
    return {
      id: it.id,
      title: it.title,
      year: it.year,
      type: it.releaseType ?? '',
      folderPath: it.stagingPath,
      format: it.quality,
      releaseGroupId: it.releaseGroupId,
      localReleaseId: it.localReleaseId,
    } as unknown as UnifiedRelease
  })

  return {
    store,
    busyId,
    busyIds,
    actionMsg,
    retry,
    merge,
    mergeMany,
    reject,
    rejectId,
    rejectOpen,
    rejectTitle,
    confirmReject,
    cancel,
    cancelId,
    cancelOpen,
    cancelTitle,
    confirmCancel,
    openInfo,
    showInfo,
    infoRelease,
  }
}
