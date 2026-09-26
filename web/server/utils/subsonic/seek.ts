import { libraryVersion } from '~/server/utils/libraryVersion'

// OFFSET paging that gets cheaper than O(offset).
//
// Symfonium-style clients build their offline library by paging `search3` with an EMPTY query, 500 rows at a time,
// through every artist, album and song. `OFFSET k` makes Postgres walk and discard k index entries, so page N costs
// O(N) and the whole sync is quadratic: at 1.9M songs that is ~4 billion entries skipped across ~3,800 requests,
// with the last pages taking seconds each.
//
// The protocol forces offsets, but the server can remember where it has been. While serving a page it notes the id
// of the row at every INTERVAL-th position; a later request at a high offset then starts from `id > checkpoint`
// and skips at most INTERVAL rows instead of all of them. A sequential sync builds the checkpoints as it goes.
// Entries are keyed by library version (libraryVersion.ts): a scan or merge changes which row sits at which
// position, so the whole set is dropped when it does.
export const SEEK_INTERVAL = 10_000

export type SeekFetcher<T> = (afterId: string | null, skip: number, take: number) => Promise<T[]>

interface Checkpoints {
  version: number
  // position P -> id of the row at position P - 1 (the last row BEFORE offset P)
  points: Map<number, string>
}

export interface Seeker {
  page: <T extends { id: string }>(key: string, offset: number, take: number, fetch: SeekFetcher<T>) => Promise<T[]>
  reset: () => void
}

export const createSeeker = (
  interval: number = SEEK_INTERVAL,
  currentVersion: () => Promise<number> = libraryVersion,
): Seeker => {
  const sets = new Map<string, Checkpoints>()

  return {
    reset: () => sets.clear(),

    page: async (key, offset, take, fetch) => {
      const version = await currentVersion()
      let set = sets.get(key)
      if (!set || set.version !== version) {
        set = { version, points: new Map() }
        sets.set(key, set)
      }

      // The nearest known checkpoint at or below `offset`.
      let from = 0
      let afterId: string | null = null
      for (let p = Math.floor(offset / interval) * interval; p > 0; p -= interval) {
        const id = set.points.get(p)
        if (id !== undefined) {
          from = p
          afterId = id
          break
        }
      }

      const rows = await fetch(afterId, offset - from, take)

      // Note every checkpoint position this page covers, for later requests.
      const firstBoundary = (Math.floor(offset / interval) + 1) * interval
      for (let boundary = firstBoundary; boundary - 1 < offset + rows.length; boundary += interval) {
        set.points.set(boundary, rows[boundary - 1 - offset]!.id)
      }
      return rows
    },
  }
}

// Shared by the /rest/* handlers.
export const subsonicSeeker: Seeker = createSeeker()
