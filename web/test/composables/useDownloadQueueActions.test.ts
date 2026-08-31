import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDownloadQueueActions } from '../../composables/useDownloadQueueActions'
import { useDownloadsStore } from '../../stores/downloads'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)
vi.stubGlobal('fetch', vi.fn())

describe('useDownloadQueueActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
  })

  it('reject opens the dialog with the item title resolved from any queue list', () => {
    const store = useDownloadsStore()
    store.queueReady = [{ id: 'r1', title: 'Ready Album' } as any]
    const actions = useDownloadQueueActions()
    actions.reject('r1')
    expect(actions.rejectOpen.value).toBe(true)
    expect(actions.rejectTitle.value).toBe('Ready Album')
  })

  it('confirmReject calls the store, closes the dialog, and clears busy state', async () => {
    const store = useDownloadsStore()
    store.queueReady = [{ id: 'r1', title: 'X' } as any]
    const rejectSpy = vi.spyOn(store, 'reject').mockResolvedValue(undefined)
    const actions = useDownloadQueueActions()
    actions.reject('r1')
    await actions.confirmReject()
    expect(rejectSpy).toHaveBeenCalledWith('r1')
    expect(actions.rejectOpen.value).toBe(false)
    expect(actions.busyId.value).toBeNull()
  })

  it('confirmReject surfaces a toast and error message on failure', async () => {
    const store = useDownloadsStore()
    store.queueReady = [{ id: 'r1', title: 'X' } as any]
    vi.spyOn(store, 'reject').mockRejectedValue({ data: { message: 'still locked' } })
    const actions = useDownloadQueueActions()
    actions.reject('r1')
    await actions.confirmReject()
    expect(actions.actionMsg.value).toBe('still locked')
  })

  it('askBulkReject is a no-op for an empty id list', () => {
    const actions = useDownloadQueueActions()
    actions.askBulkReject([])
    expect(actions.bulkRejectOpen.value).toBe(false)
  })

  it('confirmBulkReject rejects all and reports success count via toast (no throw on partial failure)', async () => {
    const store = useDownloadsStore()
    const rejectAllSpy = vi.spyOn(store, 'rejectAll').mockResolvedValue(2)
    const actions = useDownloadQueueActions()
    actions.askBulkReject(['a', 'b'])
    await actions.confirmBulkReject()
    expect(rejectAllSpy).toHaveBeenCalledWith(['a', 'b'])
    expect(actions.bulkBusy.value).toBe(false)
    expect(actions.bulkRejectOpen.value).toBe(false)
  })

  it('requeue calls store.requeue immediately (no confirm dialog) and clears busy state', async () => {
    const store = useDownloadsStore()
    const requeueSpy = vi.spyOn(store, 'requeue').mockResolvedValue(undefined)
    const actions = useDownloadQueueActions()
    await actions.requeue('r1')
    expect(requeueSpy).toHaveBeenCalledWith('r1')
    expect(actions.busyId.value).toBeNull()
  })

  it('requeue surfaces a toast and error message on failure', async () => {
    const store = useDownloadsStore()
    vi.spyOn(store, 'requeue').mockRejectedValue({ data: { message: 'not found' } })
    const actions = useDownloadQueueActions()
    await actions.requeue('r1')
    expect(actions.actionMsg.value).toBe('not found')
  })

  it('requeueAll calls store.requeueAll immediately and reports the count via toast', async () => {
    const store = useDownloadsStore()
    const requeueAllSpy = vi.spyOn(store, 'requeueAll').mockResolvedValue(2)
    const actions = useDownloadQueueActions()
    await actions.requeueAll(['a', 'b'])
    expect(requeueAllSpy).toHaveBeenCalledWith(['a', 'b'])
  })

  it('requeueAll is a no-op for an empty id list', async () => {
    const store = useDownloadsStore()
    const requeueAllSpy = vi.spyOn(store, 'requeueAll')
    const actions = useDownloadQueueActions()
    await actions.requeueAll([])
    expect(requeueAllSpy).not.toHaveBeenCalled()
  })

  it('cancel/confirmCancel mirror the reject dialog flow', async () => {
    const store = useDownloadsStore()
    store.queueActive = [{ id: 'a1', title: 'Active Album' } as any]
    const cancelSpy = vi.spyOn(store, 'cancel').mockResolvedValue(undefined)
    const actions = useDownloadQueueActions()
    actions.cancel('a1')
    expect(actions.cancelTitle.value).toBe('Active Album')
    await actions.confirmCancel()
    expect(cancelSpy).toHaveBeenCalledWith('a1')
    expect(actions.cancelOpen.value).toBe(false)
  })

  it('openInfo populates infoRelease mapped from the found queue item', () => {
    const store = useDownloadsStore()
    store.queueHistory = [{ id: 'h1', title: 'Old', year: 1999, releaseType: 'Album', stagingPath: '/p', quality: 'FLAC', releaseGroupId: 'g1', localReleaseId: 'lr1' } as any]
    const actions = useDownloadQueueActions()
    actions.openInfo('h1')
    expect(actions.showInfo.value).toBe(true)
    expect(actions.infoRelease.value).toMatchObject({ id: 'h1', title: 'Old', year: 1999, localReleaseId: 'lr1' })
  })

  it('openInfo does nothing when the id is not found in any list', () => {
    const actions = useDownloadQueueActions()
    actions.openInfo('missing')
    expect(actions.showInfo.value).toBe(false)
  })

  it('askBulkMerge + confirmBulkMerge delegates to store.mergeSelected', async () => {
    const store = useDownloadsStore()
    const mergeSelectedSpy = vi.spyOn(store, 'mergeSelected').mockResolvedValue(undefined)
    const actions = useDownloadQueueActions()
    actions.askBulkMerge(['a', 'b'])
    expect(actions.bulkMergeOpen.value).toBe(true)
    await actions.confirmBulkMerge()
    expect(mergeSelectedSpy).toHaveBeenCalledWith(['a', 'b'])
    expect(actions.bulkMergeOpen.value).toBe(false)
  })

  it('retryMany retries every selected id and clears busy state', async () => {
    const store = useDownloadsStore()
    const retrySpy = vi.spyOn(store, 'retry').mockResolvedValue(undefined)
    const actions = useDownloadQueueActions()
    await actions.retryMany(['a', 'b', 'c'])
    expect(retrySpy).toHaveBeenCalledTimes(3)
    expect(retrySpy).toHaveBeenCalledWith('b')
    expect(actions.bulkBusy.value).toBe(false)
  })

  it('retryMany keeps going when one row fails, rather than abandoning the rest', async () => {
    // There is no bulk retry endpoint, so this fans out. Promise.all would drop the remaining
    // retries the moment any single one rejected.
    const store = useDownloadsStore()
    const retrySpy = vi.spyOn(store, 'retry').mockImplementation(async (id: string) => {
      if (id === 'b') {
        throw new Error('nope')
      }
    })
    const actions = useDownloadQueueActions()
    await actions.retryMany(['a', 'b', 'c'])
    expect(retrySpy).toHaveBeenCalledTimes(3)
    expect(actions.bulkBusy.value).toBe(false)
  })

  it('retryMany is a no-op for an empty selection', async () => {
    const store = useDownloadsStore()
    const retrySpy = vi.spyOn(store, 'retry')
    await useDownloadQueueActions().retryMany([])
    expect(retrySpy).not.toHaveBeenCalled()
  })
})
