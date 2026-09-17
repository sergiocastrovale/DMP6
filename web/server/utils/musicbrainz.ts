// Read-only MusicBrainz client for the /add search/preview flow. Nothing here writes to the DB or
// filesystem - artist creation itself runs through the Rust `./add` binary (CLAUDE.md: "No scripts
// logic in the web app"). Mirrors the pacing/User-Agent of scripts/common/src/mb/api.rs so this
// process and the Rust binaries never combine to exceed MusicBrainz's rate budget.

const MB_BASE = 'https://musicbrainz.org/ws/2'
// Must match scripts/common/src/mb/api.rs::USER_AGENT exactly - MB rate-limits by User-Agent+IP.
const MB_USER_AGENT = 'DMPv6/0.1.0 ( https://github.com/dmp )'
const MIN_DELAY_MS = 1100

// Module-level serial queue: every mbFetch call, regardless of caller, waits for the previous one's
// delay before firing - a single Node process, so a plain "last request time" ref is enough (no
// cross-worker coordination needed, unlike the Rust RateLimiter which is shared across concurrent
// sync workers).
let queue: Promise<void> = Promise.resolve()

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

let lastRequestAt = 0

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_DELAY_MS - Date.now()
  if (wait > 0) {await sleep(wait)}
  lastRequestAt = Date.now()
}

// Fetches one MB path (e.g. `/artist?query=...&fmt=json`), serialized against every other mbFetch
// call in this process. One retry after a fixed 2s backoff on a 503 (MB's "server busy" load-shed,
// same as the Rust client absorbs).
export async function mbFetch(path: string): Promise<any> {
  const run = async (): Promise<any> => {
    await throttle()
    const res = await fetch(`${MB_BASE}${path}`, { headers: { 'User-Agent': MB_USER_AGENT } })
    if (res.status === 503) {
      await sleep(2000)
      await throttle()
      const retry = await fetch(`${MB_BASE}${path}`, { headers: { 'User-Agent': MB_USER_AGENT } })
      if (!retry.ok) {throw new Error(`MusicBrainz ${retry.status}`)}
      return retry.json()
    }
    if (!res.ok) {throw new Error(`MusicBrainz ${res.status}`)}
    return res.json()
  }

  // Chain onto the shared queue so concurrent callers still serialize, and a failed call doesn't
  // wedge the queue for the next one.
  const result = queue.then(run, run)
  queue = result.then(() => undefined, () => undefined)
  return result
}

export interface MbArtistSearchRow {
  mbid: string
  name: string
  disambiguation: string | null
  country: string | null
  type: string | null
}

export async function searchArtists(query: string): Promise<MbArtistSearchRow[]> {
  const data = await mbFetch(`/artist?query=${encodeURIComponent(query)}&fmt=json`)
  const artists = Array.isArray(data?.artists) ? data.artists : []
  return artists.map((a: any) => ({
    mbid: a.id,
    name: a.name,
    disambiguation: a.disambiguation || null,
    country: a.country || null,
    type: a.type || null,
  }))
}

// Direct lookup for the /add search box's "paste a MusicBrainz ID" path - a plain id lookup instead
// of the query search, since `/artist?query=<uuid>` doesn't reliably match on id.
export async function getArtistByMbid(mbid: string): Promise<MbArtistSearchRow | null> {
  try {
    const a = await mbFetch(`/artist/${mbid}?fmt=json`)
    return {
      mbid: a.id,
      name: a.name,
      disambiguation: a.disambiguation || null,
      country: a.country || null,
      type: a.type || null,
    }
  }
  catch {
    return null
  }
}
