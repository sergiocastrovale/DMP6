import { storeToRefs } from 'pinia'
import type { DownloadedReleaseItem } from '~/types/download'
import type { UnifiedRelease } from '~/types/release'

// Shared handlers + dialog state for the per-tab download queue pages.
// Thin wrappers over the downloads store so content components stay slim.
export const useDownloadQueueActions = () => {
  const store = useDownloadsStore()
  const toast = useToastStore()
  const { queueActive, queueReady, queueRejected, queueHistory } = storeToRefs(store)

  const busyId = ref<string | null>(null)
  const actionMsg = ref<string | null>(null)

  // Merge in-flight tracking + concurrency now live in the store (so the progress panel survives tab
  // switches + refresh). The composable just surfaces them.
  const { mergingIds: busyIds } = storeToRefs(store)

  const run = async (id: string, fn: () => Promise<unknown>, failMsg: string) => {
    busyId.value = id
    try {
      await fn()
    }
    catch (e: any) {
      actionMsg.value = e?.data?.message || e?.message || failMsg
      toast.error(actionMsg.value!)
    }
    finally {
      busyId.value = null
    }
  }

  const retry = (id: string) => run(id, () => store.retry(id), 'Retry failed')
  // Rejected tab: "move back to queue" — immediate, non-destructive, no confirm dialog (same
  // no-dialog precedent as retry/"Force retry").
  const requeue = (id: string) => run(id, () => store.requeue(id), 'Move to queue failed')
  const requeueAll = async (ids: string[]) => {
    if (!ids.length) {
      return
    }
    try {
      const requeued = await store.requeueAll(ids)
      toast.success(`Moved ${requeued} download${requeued === 1 ? '' : 's'} back to queue`)
    }
    catch (e: any) {
      toast.error(e?.data?.message || e?.message || 'Move to queue failed')
    }
  }
  const merge = (id: string) => store.merge(id).catch((e: any) => {
    actionMsg.value = e?.data?.message || e?.message || 'Merge failed'
    toast.error(actionMsg.value!)
  })
  const mergeMany = (ids: string[]) => store.mergeSelected(ids)

  const findItem = (id: string | null) =>
    queueActive.value.find(i => i.id === id)
    ?? queueReady.value.find(i => i.id === id)
    ?? queueRejected.value.find(i => i.id === id)
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

  // Bulk reject dialog (Failed / Unavailable / Ready-to-merge multi-select)
  const bulkBusy = ref(false)
  const bulkRejectIds = ref<string[]>([])
  const bulkRejectOpen = ref(false)
  const askBulkReject = (ids: string[]) => {
    if (!ids.length) {
      return
    }
    bulkRejectIds.value = ids
    bulkRejectOpen.value = true
  }
  const confirmBulkReject = async () => {
    const ids = bulkRejectIds.value
    bulkRejectOpen.value = false
    bulkRejectIds.value = []
    if (!ids.length) {
      return
    }
    bulkBusy.value = true
    try {
      const rejected = await store.rejectAll(ids)
      toast.success(`Rejected ${rejected} download${rejected === 1 ? '' : 's'}`)
    }
    catch (e: any) {
      toast.error(e?.data?.message || e?.message || 'Reject failed')
    }
    finally {
      bulkBusy.value = false
    }
  }

  // Bulk merge dialog (Ready-to-merge multi-select) — merge is slow, so confirm first.
  const bulkMergeIds = ref<string[]>([])
  const bulkMergeOpen = ref(false)
  const askBulkMerge = (ids: string[]) => {
    if (!ids.length) {
      return
    }
    bulkMergeIds.value = ids
    bulkMergeOpen.value = true
  }
  const confirmBulkMerge = async () => {
    const ids = bulkMergeIds.value
    bulkMergeOpen.value = false
    bulkMergeIds.value = []
    if (!ids.length) {
      return
    }
    await mergeMany(ids)
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
    requeue,
    requeueAll,
    merge,
    mergeMany,
    reject,
    rejectId,
    rejectOpen,
    rejectTitle,
    confirmReject,
    bulkBusy,
    bulkRejectIds,
    bulkRejectOpen,
    askBulkReject,
    confirmBulkReject,
    bulkMergeIds,
    bulkMergeOpen,
    askBulkMerge,
    confirmBulkMerge,
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
