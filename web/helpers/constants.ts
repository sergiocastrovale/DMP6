import type { ReleaseStatus } from '~/types/release'
import type { Tone } from '~/types/ui'
import type { ReleaseTypeBucketId, PlayPeriod } from '~/types/stats'

// Accent themes (Settings → Themes). Each id matches an `html[data-theme=…]` block in
// assets/css/themes.css, which redefines the amber ramp - `amber` is the default and needs no
// block. `swatchVar` is that theme's own 400 step, held fixed so the picker's squares keep their
// own colours whatever theme is active. Persisted client-side only, no DB.
//
// `oklch` mirrors that ramp's 400 step exactly as theme.css / themes.css declare it - a WebGL
// shader can't read a CSS custom property, and getComputedStyle serializes these back as
// `oklch(…)` rather than resolved sRGB, so there is nothing to parse at runtime either. No
// visualizer preset currently reads it (the last one that did, Spectrum's accent()-locked level
// meter, was replaced - see the Visualizer section below), but the conversion this exists to feed,
// helpers/oklch.ts's oklchToHueDegrees(), stays: a different angle from the oklch one (amber is 75
// in oklch, ~40 in HSV) is exactly the kind of thing a future accent-locked preset would need
// again, so this stays the authored triple rather than being pre-reduced to a single number.
export const themes = [
  { id: 'amber', label: 'Amber', swatchVar: '--swatch-amber', oklch: [0.78, 0.16, 75] },
  { id: 'green', label: 'Green', swatchVar: '--swatch-green', oklch: [0.78, 0.16, 165] },
  { id: 'cyan', label: 'Cyan', swatchVar: '--swatch-cyan', oklch: [0.78, 0.14, 220] },
  { id: 'violet', label: 'Violet', swatchVar: '--swatch-violet', oklch: [0.78, 0.14, 305] },
  { id: 'rose', label: 'Rose', swatchVar: '--swatch-rose', oklch: [0.78, 0.15, 350] },
] as const satisfies ReadonlyArray<{ id: string, label: string, swatchVar: string, oklch: readonly [number, number, number] }>

export type ThemeId = (typeof themes)[number]['id']
export const DEFAULT_THEME: ThemeId = 'amber'

// UI size (Settings → Themes). Each id matches an `html[data-size=…]` block in themes.css that sets
// `--ui-scale`; theme.css's whole type scale is `calc(<px> * var(--ui-scale))`, so one multiplier
// resizes every `text-*` utility in the app. Order is the slider's order, small → large.
export const uiSizes = [
  { id: 'xs', label: '-15%', scale: 0.85 },
  { id: 'sm', label: '-5%', scale: 0.95 },
  { id: 'default', label: 'Default', scale: 1 },
  { id: 'lg', label: '+10%', scale: 1.1 },
  { id: 'xl', label: '+20%', scale: 1.2 },
  { id: '2xl', label: '+25%', scale: 1.25 },
] as const

export type UiSizeId = (typeof uiSizes)[number]['id']
export const DEFAULT_UI_SIZE: UiSizeId = 'default'

// One localStorage entry holds the whole appearance choice: `{"accent":"violet","size":"lg"}`.
export const THEME_STORAGE_KEY = 'dmp-theme'

// Fullscreen visualizer presets, in switcher order. Each id keys a fragment shader in
// helpers/visualizer/shaders.ts; `key` is the digit that jumps straight to it from the overlay.
export const visualizerPresets = [
  { id: 'chaos', label: 'Chaos', description: 'Spiraling Julia set on the Mandelbrot boundary, no bass dependence', key: '1' },
  { id: 'fractal', label: 'Fractal', description: 'Kaleidoscopic Julia set orbiting on the bass', key: '2' },
  { id: 'flow', label: 'Flow', description: 'Domain-warped noise field, continuously flowing plasma', key: '3' },
  { id: 'julia', label: 'Julia', description: 'Julia set whose power drifts, morphing its symmetry order', key: '4' },
] as const

export type VisualizerPresetId = (typeof visualizerPresets)[number]['id']
export const DEFAULT_VISUALIZER_PRESET: VisualizerPresetId = 'chaos'
// Its own entry rather than a field on dmp-theme: the accent/size pair is an appearance preference
// the server-rendered head script reads pre-paint, and the visualizer has no business in that path.
export const VISUALIZER_STORAGE_KEY = 'dmp-visualizer'
// How long the overlay sits still before its HUD fades out. Long enough to read a track title,
// short enough that the visuals aren't permanently framed by chrome.
export const VISUALIZER_HUD_IDLE_MS = 3000
// FFT size fed to the AnalyserNode. Halves to 128 frequency bins (`AnalyserNode.frequencyBinCount`)
// - plenty of resolution for splitBands()/rms() (helpers/audioBands.ts) to derive the three scalar
// bass/mid/treble bands and overall level every preset actually reads; no preset uploads the raw
// curve itself any more (the FFT/waveform data textures that once did belonged to presets that
// have since been replaced - see CLAUDE.md's Visualizer section).
export const VISUALIZER_FFT_SIZE = 256
// Shared by the FLAC->MP3 conversion target bitrate and the download source minimum-bitrate filter
// (both Settings → Downloads dropdowns) - same value set, two different meanings.
export const bitrateOptions = [320, 256, 192, 128] as const
export const SKELETON_GRID_SIZE = 10
// Rows shown per page in the /explore session history; the store retains EXPLORER_SESSION_HISTORY_CAP.
export const EXPLORE_HISTORY_PAGE_SIZE = 15
// TV/cinema mode caps to the most recent plays instead of paginating - a paginated list doesn't
// read well blown up from a couch.
export const EXPLORE_HISTORY_TV_LIMIT = 3
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60
// Once an artist has more stored ArtistFact rows than this, GET /tracks/[id]/fact serves from the
// DB only and never calls Genius again for that artist.
export const ARTIST_FACTS_DB_THRESHOLD = 15
// Max chars per extracted Genius fact chunk before it's split at a sentence boundary.
export const GENIUS_FACT_MAX_CHARS = 320
// Shared by the desktop player bar's shuffle pill and the mobile expanded sheet's transport row.
export const SHUFFLE_CONTEXT_LABELS: Record<string, string> = {
  explorer: 'Explorer',
  catalogue: 'Catalogue',
  artist: 'Artist',
  release: 'Release',
}
export const SHUFFLE_TOOLTIPS: Record<string, string> = {
  off: 'Shuffle: Off',
  release: 'Shuffle: Release',
  artist: 'Shuffle: Artist',
  catalogue: 'Shuffle: Catalogue',
  explorer: 'Explorer mode - click to turn off',
}
// Ring-buffer cap for the terminal store's line buffer - a full ./index run can stream 19K+ lines;
// capping keeps the reactive array (and every component re-scanning it per chunk) bounded (audit #92).
export const TERMINAL_LINES_CAP = 5000

// Terminal store auto-reconnect (stores/terminal.ts). RECONNECT_BACKOFF_MS: delays tried in order
// after a dropped connection before giving up and leaving connectionLost showing (a network blip
// resolves in seconds; a longer outage backs off rather than hammering the server). Same delays used
// whether the drop happened mid-run() or mid-reconnect(). RECONNECT_STOP_GUARD_MS: how long after the
// user presses Stop a session is considered "intentionally stopped" - auto-reconnect and the orphan
// poll both skip it for this window, so Stop can't get raced by a reconnect attempt already in
// flight. ORPHAN_POLL_MS: how often plugins/terminalReconnect.client.ts checks for a session running
// in the background that this tab has no memory of (page reload, or the drop happened on a page that
// was never watching the run at all).
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000]
export const RECONNECT_STOP_GUARD_MS = 30000
export const ORPHAN_POLL_MS = 15000

// Artist page download-status poll cadences. Live: a row is mid-acquisition (or a merge is running),
// so it changes on its own every couple of seconds. Monitored: nothing is in flight, but background
// auto-acquisition can create rows with no click in this tab, so keep a slow heartbeat. An
// unmonitored, idle artist polls not at all.
export const DL_POLL_LIVE_MS = 2000
export const DL_POLL_MONITORED_MS = 30000

// Friendly labels for the terminal/progress panel, keyed by the running command (or stream label).
export const commandLabels: Record<string, string> = {
  './index': 'Indexing library…',
  './sync': 'Syncing with MusicBrainz…',
  './tidy': 'Tidying library…',
  './refresh': 'Refreshing library…',
  './audit': 'Auditing metadata…',
  './fix': 'Applying fixes…',
  './playlists': 'Generating playlists…',
  './artist-photos': 'Looking up artist photo…',
}

// The library-wide scan menu (components/settings/ScanActions.vue). The artist dropdown has its own, narrower
// set below - the two surfaces stopped sharing one list once the artist actions became rebuilds
// (delete + re-index) rather than scopes of the global ones.
//
// `admin` marks the actions that carry destructive flags (`--overwrite*`, `--prune`). The server
// rejects those for non-admins anyway (DESTRUCTIVE_FLAGS in server/utils/terminalCommand.ts); hiding
// them here just avoids offering a button that is guaranteed to 403.
export const scanActions = [
  { id: 'check', icon: 'Search', text: 'Check for new files', subtext: 'Index new files, sync & tidy', admin: false },
  { id: 'full', icon: 'RefreshCw', text: 'Full re-scan', subtext: 'Re-read every tag, prune missing files, rematch', admin: true },
  { id: 'inspect', icon: 'FileSearch', text: 'Re-check changed files', subtext: 'Re-read tags for files that changed on disk', admin: false },
  { id: 'index', icon: 'HardDriveDownload', text: 'Index only', subtext: 'Index new local files', admin: false },
  { id: 'sync', icon: 'Globe', text: 'Sync only', subtext: 'Sync pending releases, then tidy', admin: false },
] as const

export type ScanAction = (typeof scanActions)[number]

// One artist, four intents, ordered cheapest-first. Every entry but the first wipes the artist's rows
// before rebuilding them, so each one names what it destroys: the titles are the promise, the subtexts
// the exact scripts. Nothing here is a partial pass - "no MusicBrainz" means the artist page stays
// unmatched until a sync runs.
export const artistScanActions = [
  { id: 'check', icon: 'Search', text: 'Scan for new files', subtext: 'Index new files, then sync what they added', admin: false },
  { id: 'rebuild', icon: 'RefreshCw', text: 'Rebuild everything', subtext: 'Delete artist, re-index every file, re-match against MusicBrainz', admin: true },
  { id: 'reindex', icon: 'HardDriveDownload', text: 'Rebuild from files only', subtext: 'Delete artist, re-index every file - no MusicBrainz, stays unmatched', admin: true },
  { id: 'resync', icon: 'Globe', text: 'Re-match from scratch', subtext: 'Keep local files, re-match every release against MusicBrainz', admin: true },
] as const

export type ArtistScanAction = (typeof artistScanActions)[number]

// Non-admins only ever see the non-destructive entries; the rest would 403 at the server.
export const visibleScanActions = (isAdmin: boolean): ScanAction[] =>
  scanActions.filter(s => isAdmin || !s.admin)

export const visibleArtistScanActions = (isAdmin: boolean): ArtistScanAction[] =>
  artistScanActions.filter(s => isAdmin || !s.admin)

// The Queue tab's subtab filters. Downloading, failed, unavailable and rejected used to be four
// sibling pages with four near-identical copies of the same table; they are one page now, and this is
// the only place the filter -> DownloadedRelease status mapping lives. `all` deliberately carries no
// statuses - it means "everything the Queue tab holds".
export const queueFilters: { key: string, label: string, statuses: string[] }[] = [
  { key: 'all', label: 'All', statuses: [] },
  { key: 'downloading', label: 'Downloading', statuses: ['SEARCHING', 'DOWNLOADING', 'ENRICHING'] },
  { key: 'failed', label: 'Failed', statuses: ['FAILED', 'ABANDONED'] },
  { key: 'unavailable', label: 'Unavailable', statuses: ['UNAVAILABLE'] },
  { key: 'rejected', label: 'Rejected', statuses: ['REJECTED'] },
]

// The five completeness bands. Five steps need more granularity than the six semantic tones
// (accent/success/warning/danger/info/muted) give a single status, so this walks the red ->
// orange -> amber -> green ramps directly instead of going through a tone - kept in the same
// {color,textColor,bgColor} shape as before so consumers (FilterCompleteness, Completeness) don't
// need a second change when their own page is retokenised.
export const completenessRanges = [
  { min: 0, max: 20, label: '0% – 20%', color: 'bg-red-400', textColor: 'text-red-400', bgColor: 'bg-red-400/15' },
  { min: 20, max: 40, label: '20% – 40%', color: 'bg-orange-500', textColor: 'text-orange-500', bgColor: 'bg-orange-500/15' },
  { min: 40, max: 60, label: '40% – 60%', color: 'bg-orange-400', textColor: 'text-orange-400', bgColor: 'bg-orange-400/15' },
  { min: 60, max: 80, label: '60% – 80%', color: 'bg-amber-400', textColor: 'text-amber-400', bgColor: 'bg-amber-400/15' },
  { min: 80, max: 100, label: '80% – 100%', color: 'bg-green-500', textColor: 'text-green-500', bgColor: 'bg-green-500/15' },
]

export const getCompletenessRange = (completeness: number) =>
  completenessRanges.find(r => completeness >= r.min && completeness < r.max) ?? completenessRanges.at(-1)!

// Browse's sort-by options. Shared by the summarized table's sortable headers and
// browseFilterSummary's one-line label lookup, so the two controls stay interchangeable rather than
// each reaching a subset of the orders.
export const browseSortOptions = [
  { value: 'name', label: 'Name' },
  { value: 'releases', label: 'Releases' },
  { value: 'tracks', label: 'Tracks' },
  { value: 'playCount', label: 'Play count' },
  { value: 'completeness', label: 'Completeness' },
  { value: 'recent', label: 'Recently added' },
  { value: 'updated', label: 'Recently updated' },
]

// browse/FiltersSidebar.vue's sort chips - explicit asc/desc pairs (rather than one button per
// column plus a separate direction toggle) so both ends of every order are one click away and
// visible at once. Listed as adjacent pairs so the sidebar's 2-column grid lines each pair up
// side by side.
export const browseSortPairOptions = [
  { sortBy: 'name', sortDir: 'asc', label: 'A-Z' },
  { sortBy: 'name', sortDir: 'desc', label: 'Z-A' },
  { sortBy: 'releases', sortDir: 'desc', label: 'Most releases' },
  { sortBy: 'releases', sortDir: 'asc', label: 'Fewest releases' },
  { sortBy: 'tracks', sortDir: 'desc', label: 'Most tracks' },
  { sortBy: 'tracks', sortDir: 'asc', label: 'Fewest tracks' },
  { sortBy: 'playCount', sortDir: 'desc', label: 'Most played' },
  { sortBy: 'playCount', sortDir: 'asc', label: 'Least played' },
  { sortBy: 'completeness', sortDir: 'desc', label: 'Most complete' },
  { sortBy: 'completeness', sortDir: 'asc', label: 'Least complete' },
  { sortBy: 'recent', sortDir: 'desc', label: 'Newest added' },
  { sortBy: 'recent', sortDir: 'asc', label: 'Oldest added' },
  { sortBy: 'updated', sortDir: 'desc', label: 'Newest updated' },
  { sortBy: 'updated', sortDir: 'asc', label: 'Oldest updated' },
] as const

// Artist page's release sort options - each value bakes in its own direction, explicit pairs same
// as browseSortPairOptions, used by artist/FiltersSidebar.vue's sort chips.
export const artistReleaseSortOptions = [
  { value: 'year-asc', label: 'Oldest first' },
  { value: 'year-desc', label: 'Newest first' },
  { value: 'title-asc', label: 'Title (A-Z)' },
  { value: 'title-desc', label: 'Title (Z-A)' },
  { value: 'tracks-desc', label: 'Most tracks' },
  { value: 'tracks-asc', label: 'Fewest tracks' },
  { value: 'plays-desc', label: 'Most played' },
  { value: 'plays-asc', label: 'Least played' },
]

// Artist page's release-type filter options, used by artist/FiltersSidebar.vue's checkboxes.
export const releaseTypeOptions = [
  { value: 'album', label: 'Albums' },
  { value: 'ep', label: 'EPs' },
  { value: 'single', label: 'Singles' },
  { value: 'other', label: 'Other' },
]

// DownloadedRelease.status -> colour, shared by DownloadProgress's bar and any per-release
// "Downloading"/"Enriching" pill (artist/ReleaseGroupDetails.vue) so the two always agree.
export const downloadStatusTone: Record<string, Tone> = {
  SEARCHING: 'muted',
  DOWNLOADING: 'accent',
  ENRICHING: 'info',
  READY: 'success',
  PROMOTED: 'success',
  FAILED: 'danger',
  ABANDONED: 'danger',
  REJECTED: 'muted',
}

// The one release-status -> colour map. Every status badge in the app (release/StatusBadge.vue,
// artist/FiltersSidebar.vue, TrackList.vue) reads `tone` from here through helpers/ui.ts's
// toneBg/toneFill/toneText - previously each of those three kept its own copy, and they had
// drifted (TrackList's copy was missing MISSING_TRACKS entirely, silently falling through).
export const statuses: { value: ReleaseStatus, label: string, tone: Tone, description: string, weight: number }[] = [
  {
    value: 'COMPLETE',
    label: 'Complete',
    tone: 'success',
    description: 'Fully matched with MusicBrainz.',
    weight: 1,
  },
  {
    value: 'EXTRA_TRACKS',
    label: 'Extra tracks',
    tone: 'info',
    description: 'Local release has more tracks than MusicBrainz.',
    weight: 2,
  },
  {
    value: 'MISSING_TRACKS',
    label: 'Missing tracks',
    tone: 'warning',
    description: 'Local release has less tracks than MusicBrainz.',
    weight: 3,
  },
  {
    value: 'INCOMPLETE',
    label: 'Incomplete',
    tone: 'accent',
    description: 'Tracks present but titles could not be matched.',
    weight: 4,
  },
  {
    value: 'MISSING',
    label: 'Missing',
    tone: 'danger',
    description: 'MusicBrainz release does not exist in the local catalogue.',
    weight: 5,
  },
  {
    value: 'UNKNOWN',
    label: 'Unknown',
    tone: 'muted',
    description: 'Not yet scored, or the files don\'t identify a single album.',
    weight: 6,
  },
  {
    value: 'UNMATCHED',
    label: 'Unmatched',
    tone: 'accent',
    description: 'Local release not found in MusicBrainz.',
    weight: 7,
  },
]

export const getStatus = (value: ReleaseStatus) =>
  statuses.find(s => s.value === value) ?? statuses.find(s => s.value === 'UNKNOWN')!

// Statistics → Release Types metric (pages/statistics/types.vue - one pivoted table, one column per
// bucket). Display/column order only - classification priority (box-set beats compilation beats
// live, ...) is separate and hardcoded in server/utils/releaseTypeBuckets.ts, since that order
// (rarest/most-specific first) reads badly as a display order (most people care about Albums/EPs
// first).
// shortLabel is the types.vue table's column header - narrower than the index card's full label
// (8 columns need to fit side by side; the index card has a whole row's width per item).
export const releaseTypeBuckets: { id: ReleaseTypeBucketId, label: string, shortLabel: string }[] = [
  { id: 'album', label: 'Albums', shortLabel: 'Albums' },
  { id: 'ep', label: 'EPs', shortLabel: 'EPs' },
  { id: 'live', label: 'Live albums', shortLabel: 'Live' },
  { id: 'soundtrack', label: 'Soundtracks', shortLabel: 'OST' },
  { id: 'single', label: 'Singles', shortLabel: 'Singles' },
  { id: 'compilation', label: 'Compilations', shortLabel: 'Compilations' },
  { id: 'box-set', label: 'Box sets', shortLabel: 'Box' },
  { id: 'unknown', label: 'Unknown', shortLabel: 'Unknown' },
]

// Statistics → Recent Plays panel (below Total Playtime, pages/statistics/index.vue) and its
// per-period detail subpage (pages/statistics/recent-plays/[period].vue). "Last week" is a trailing
// 7-day window, not the current calendar week - the other three are calendar-boundary, today/month/
// year-to-date (server/utils/userPlays.ts's periodStart is the one place that math lives).
export const playPeriods: { id: PlayPeriod, label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
]

// Settings → Users "connected now" panel (server/utils/presence.ts, components/settings/UsersLive.vue).
// In-memory, single-instance presence - no DB table, no cross-restart persistence (see CLAUDE.md
// Data Model). HEARTBEAT is how often a live tab/Subsonic call touches its entry; STALE is when an
// untouched entry drops off the list entirely (2.5x the heartbeat, tolerating one missed beat before
// disappearing); PLAYING_STALE_MS is separate and shorter - a track keeps showing but flips to
// "paused" once its own timestamp goes quiet, since a listener can stay online (heartbeat still
// fresh) well after playback itself stops. REFRESH is the admin panel's own poll interval.
export const PRESENCE_HEARTBEAT_MS = 30_000
export const PRESENCE_STALE_MS = 75_000
export const PRESENCE_PLAYING_STALE_MS = 60_000
export const USERS_LIVE_REFRESH_MS = 10_000

// MusicBrainz artist MBID - used by /add's search box to detect a pasted id vs a name query
// (server/api/artists/mb-search.get.ts).
export const MBID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Search (server/utils/searchRank.ts). Trigram indexes need >= 3 characters to be usable, so a 2-character
// substring search over 1.9M tracks/150k releases would fall back to a sequential scan; artists (46k rows)
// stay cheap enough at 2. TIER_CAP bounds the rows fetched per rank tier; TOTAL_CAP is where the result
// count stops being exact and the UI shows "1000+".
export const SEARCH_MIN_CHARS = { artists: 2, releases: 3, tracks: 3 } as const
export const SEARCH_TIER_CAP = 500
export const SEARCH_TOTAL_CAP = 1000

// How many random tracks /api/artists/[slug]/shuffle returns for the player's artist-shuffle queue.
export const ARTIST_SHUFFLE_SIZE = 500

// Downloads page queue poll (stores/downloads.ts). ACTIVE while a transfer or merge is moving; IDLE when the
// page is open only because acquisition *could* start a download - the monitor's own cadence is minutes.
export const QUEUE_POLL_ACTIVE_MS = 2000
export const QUEUE_POLL_IDLE_MS = 15_000
// Settings → Library scan status while a script is running (components/settings/RealTimeStatus.vue).
export const SCAN_STATUS_POLL_MS = 3000

// Tracks returned for one playlist page (/api/playlists/[slug]). The generated GENRE/REGION playlists are capped at
// exactly 500 by `./playlists` itself, so this matches them; a manual playlist longer than this is truncated.
export const PLAYLIST_PAGE_CAP = 500

// The client sends its whole explorer history; a hostile or buggy one must not become a giant NOT IN list.
export const MAX_EXCLUDE_IDS = 200

// A queue or radio session gives up after this many unplayable tracks in a row (missing file, decode error).
export const MAX_CONSECUTIVE_PLAYBACK_ERRORS = 3

// Guest artists listed on an artist page ("appears with"): the most frequent collaborators, not every credit.
export const RELATED_ARTISTS_LIMIT = 50

// Server-side statement timeouts (server/utils/statementTimeout.ts): a runaway query is cancelled by Postgres and
// answered with a 503 instead of holding a connection and piling up behind itself.
export const SEARCH_STATEMENT_TIMEOUT_MS = 5_000
export const STATS_STATEMENT_TIMEOUT_MS = 20_000
export const LABS_STATEMENT_TIMEOUT_MS = 30_000
// Queries slower than this are logged (server/utils/slowQuery.ts).
export const SLOW_QUERY_MS = 1_000

// The browse artist grid only windows (renders just the rows near the viewport) past this many items; below it the
// whole list is cheaper to keep than to measure. Overscan is in grid rows, above and below the viewport.
export const WINDOWED_GRID_MIN_ITEMS = 150
export const WINDOWED_GRID_OVERSCAN_ROWS = 4
