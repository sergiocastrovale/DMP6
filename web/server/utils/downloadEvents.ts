import { DOWNLOAD_EVENTS_SETTLE_MS } from '~/helpers/constants'
import { createChangeNotifier } from '~/server/utils/changeNotifier'

// What the Downloads pages listen to (GET /api/downloads/events) instead of polling the heavy queue endpoint: the queue
// rows, the pause state and the merge batch. In-process, like presence - it assumes the single Nitro instance the rest of
// the app does; a write made by another process (a second dev server on the same database) is caught by the client's
// slow backstop poll instead.
export const downloadChanges = createChangeNotifier(DOWNLOAD_EVENTS_SETTLE_MS)

export const notifyDownloadsChanged = (): void => downloadChanges.notify()

// The SQL Prisma logs for a write to a download row. Recognising it at the client (server/utils/prisma.ts) covers all
// ~35 places that write DownloadedRelease - the monitor loop, promote, acquire, the routes - with no call to remember at
// each, including the ones added later.
const DOWNLOAD_WRITE = /^\s*(?:INSERT INTO|UPDATE|DELETE FROM)\s+"public"\."DownloadedRelease"/

export const isDownloadWrite = (sql: string): boolean => DOWNLOAD_WRITE.test(sql)
