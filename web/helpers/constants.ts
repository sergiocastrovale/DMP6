import type { ReleaseStatus } from '~/types/release'
import type { Tone } from '~/helpers/ui'

export const maxGenres = 5
export const SKELETON_GRID_SIZE = 10
// Rows shown per page in the /explore session history; the store retains EXPLORER_SESSION_HISTORY_CAP.
export const EXPLORE_HISTORY_PAGE_SIZE = 15
// TV/cinema mode caps to the most recent plays instead of paginating - a paginated list doesn't
// read well blown up from a couch.
export const EXPLORE_HISTORY_TV_LIMIT = 3
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60
// Ring-buffer cap for the terminal store's line buffer - a full ./index run can stream 19K+ lines;
// capping keeps the reactive array (and every component re-scanning it per chunk) bounded (audit #92).
export const TERMINAL_LINES_CAP = 5000

// Friendly labels for the terminal/progress panel, keyed by the running command (or stream label).
export const commandLabels: Record<string, string> = {
  './index': 'Indexing library…',
  './sync': 'Syncing with MusicBrainz…',
  './refresh': 'Refreshing library…',
  './audit': 'Auditing metadata…',
  './fix': 'Applying fixes…',
  './playlists': 'Generating playlists…',
}

// The library-wide scan menu (components/settings/ScanActions.vue). The artist dropdown has its own, narrower
// set below - the two surfaces stopped sharing one list once the artist actions became rebuilds
// (delete + re-index) rather than scopes of the global ones.
//
// `admin` marks the actions that carry destructive flags (`--overwrite*`, `--prune`). The server
// rejects those for non-admins anyway (DESTRUCTIVE_FLAGS in server/utils/terminalCommand.ts); hiding
// them here just avoids offering a button that is guaranteed to 403.
export const scanActions = [
  { id: 'check', icon: 'Search', text: 'Check for new files', subtext: 'Index new files & sync', admin: false },
  { id: 'full', icon: 'RefreshCw', text: 'Full re-scan', subtext: 'Re-read every tag, prune missing files, rematch', admin: true },
  { id: 'inspect', icon: 'FileSearch', text: 'Re-check changed files', subtext: 'Re-read tags for files that changed on disk', admin: false },
  { id: 'index', icon: 'HardDriveDownload', text: 'Index only', subtext: 'Index new local files', admin: false },
  { id: 'sync', icon: 'Globe', text: 'Sync only', subtext: 'Sync pending releases against MusicBrainz', admin: false },
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

// The five match-score bands. Five steps need more granularity than the six semantic tones
// (accent/success/warning/danger/info/muted) give a single status, so this walks the red ->
// orange -> amber -> green ramps directly instead of going through a tone - kept in the same
// {color,textColor,bgColor} shape as before so consumers (FilterScore, AverageMatchScore) don't
// need a second change when their own page is retokenised.
export const scoreRanges = [
  { min: 0, max: 20, label: '0% – 20%', color: 'bg-red-400', textColor: 'text-red-400', bgColor: 'bg-red-400/15' },
  { min: 20, max: 40, label: '20% – 40%', color: 'bg-orange-500', textColor: 'text-orange-500', bgColor: 'bg-orange-500/15' },
  { min: 40, max: 60, label: '40% – 60%', color: 'bg-orange-400', textColor: 'text-orange-400', bgColor: 'bg-orange-400/15' },
  { min: 60, max: 80, label: '60% – 80%', color: 'bg-amber-400', textColor: 'text-amber-400', bgColor: 'bg-amber-400/15' },
  { min: 80, max: 100, label: '80% – 100%', color: 'bg-green-500', textColor: 'text-green-500', bgColor: 'bg-green-500/15' },
]

export const getScoreRange = (score: number) =>
  scoreRanges.find(r => score >= r.min && score < r.max) ?? scoreRanges.at(-1)!

// The one release-status -> colour map. Every status badge in the app (release/StatusBadge.vue,
// artist/StatusChips.vue, TrackList.vue) reads `tone` from here through helpers/ui.ts's
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
    description: 'Status not yet determined. Needs sync.',
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

export const linkIcons: Record<string, { viewBox: string; path: string }> = {
  'discogs': {
    viewBox: '0 0 24 24',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-14c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  },
  'allmusic': {
    viewBox: '0 0 24 24',
    path: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  },
  'bandcamp': {
    viewBox: '0 0 24 24',
    path: 'M22 12l-8.5 6H2l8.5-6H22z',
  },
  'youtube': {
    viewBox: '0 0 24 24',
    path: 'M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zM9 16V8l8 4-8 4z',
  },
  'soundcloud': {
    viewBox: '0 0 24 24',
    path: 'M1 18v-4h1v4H1zm3-7v7h1v-7H4zm3-2v9h1V9H7zm3 2v7h1v-7h-1zm3-4v11h1V7h-1zm4.5-1c-2.49 0-4.5 2.01-4.5 4.5v6.5h9v-6.5c0-2.49-2.01-4.5-4.5-4.5z',
  },
  'spotify': {
    viewBox: '0 0 24 24',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 14.36c-.2.3-.56.4-.86.2-2.36-1.44-5.33-1.77-8.83-.97-.34.08-.67-.14-.75-.47-.08-.34.14-.67.47-.75 3.83-.87 7.12-.5 9.77 1.12.3.2.4.56.2.87zm1.23-2.72c-.25.37-.7.5-1.07.25-2.7-1.66-6.82-2.14-10.01-1.17-.42.13-.86-.1-.99-.52-.13-.42.1-.86.52-.99 3.64-1.11 8.17-.57 11.3 1.33.37.25.5.7.25 1.1zm.1-2.83c-3.24-1.93-8.58-2.1-11.67-1.16-.5.15-1.03-.13-1.18-.63-.15-.5.13-1.03.63-1.18 3.55-1.08 9.44-.87 13.17 1.34.45.27.6.86.33 1.31-.27.45-.86.6-1.28.32z',
  },
  'apple music': {
    viewBox: '0 0 24 24',
    path: 'M23 5.5C23 4.12 21.88 3 20.5 3h-17C2.12 3 1 4.12 1 5.5v13C1 19.88 2.12 21 3.5 21h17c1.38 0 2.5-1.12 2.5-2.5v-13zM16 14.5c0 1.65-1.35 3-3 3s-3-1.35-3-3 1.35-3 3-3V8l4-1v3.5c0 1.65-1.35 3-3 3s-1-.35-1-.5.35-.5 1-.5 1-.85 1-1.5V11l-4 1v2.5c0 1.65 1.35 3 3 3 .55 0 1-.45 1-1V14h2v.5z',
  },
  'wikidata': {
    viewBox: '0 0 24 24',
    path: 'M2 4v16h2V4H2zm4 0v16h1V4H6zm2 0v16h2V4H8zm4 0v16h1V4h-1zm2 0v16h2V4h-2zm4 0v16h2V4h-2z',
  },
  'wikipedia': {
    viewBox: '0 0 24 24',
    path: 'M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.436 0 .135.053.33.166.601 1.082 2.646 4.818 10.521 4.818 10.521l2.681-5.312-2.217-4.849c-.135-.29-.271-.517-.392-.681-.121-.164-.324-.26-.617-.281l-.43-.03c-.15 0-.225-.057-.225-.176v-.434l.051-.045c.924-.005 4.531 0 4.531 0l.051.045v.434c0 .119-.075.176-.225.176l-.398.031c-.53.029-.654.164-.372.436l1.815 4.03 1.883-3.714c.199-.39.3-.671.3-.836 0-.336-.188-.502-.564-.502h-.488c-.15 0-.225-.057-.225-.176v-.434l.051-.045c.924-.005 3.556 0 3.556 0l.051.045v.434c0 .119-.075.176-.225.176l-.188.016c-.752.06-1.166.526-1.541 1.268l-2.518 4.943 2.746 5.477c1.082-2.148 3.506-7.608 4.449-9.834.175-.414.262-.726.262-.94 0-.336-.21-.518-.63-.548l-.413-.03c-.15 0-.225-.057-.225-.176v-.434l.051-.045c.924-.005 3.751 0 3.751 0l.051.045v.434c0 .119-.075.176-.225.176-.961.06-1.478.451-1.893 1.406-1.053 2.38-3.704 7.932-5.024 10.805-.616 1.074-1.127.931-1.532.029l-2.441-5.072z',
  },
  'last.fm': {
    viewBox: '0 0 24 24',
    path: 'M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.422 0 3.19 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.594 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.932-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z',
  },
  'imdb': {
    viewBox: '0 0 24 24',
    path: 'M14.31 9.588v.005c-.077-.048-.227-.07-.42-.07v4.815c.27 0 .44-.06.5-.165.062-.104.093-.405.093-.903v-2.86c0-.33-.013-.556-.038-.68-.025-.122-.07-.2-.135-.14zM22 0H2C.9 0 0 .9 0 2v20c0 1.1.9 2 2 2h20c1.1 0 2-.9 2-2V2c0-1.1-.9-2-2-2zM4.69 14.1H3.03V9.59h1.66v4.51zm4.7 0H7.81v-3.23l-.6 3.23H6.1l-.6-3.07v3.07H4.16V9.59h2.28c.07.36.14.76.22 1.2l.2 1.13.4-2.33h2.13v4.51zm4.44-.01h-1.32v-.36c-.19.15-.37.26-.56.34-.19.08-.39.12-.6.12-.2 0-.37-.04-.5-.13-.14-.09-.24-.24-.29-.46-.03-.13-.05-.37-.05-.73V9.59h1.32v3.63c0 .27.01.43.04.49.03.06.1.09.2.09.15 0 .31-.08.46-.23V9.59h1.32v4.5h-.02zm4.13-1.22c0 .5-.02.84-.05 1.01-.04.17-.1.31-.2.41-.1.1-.23.18-.38.22-.15.04-.39.06-.7.06h-2.08V9.59h1.73c.57 0 .95.02 1.13.06.19.04.34.12.46.25.12.13.2.3.24.5.04.2.06.56.06 1.08v1.39h-.21z',
  },
  'musicbrainz': {
    viewBox: '0 0 24 24',
    path: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z',
  },
  'rate your music': {
    viewBox: '0 0 24 24',
    path: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
  },
  'setlist.fm': {
    viewBox: '0 0 24 24',
    path: 'M3 4h18v2H3V4zm0 7h18v2H3v-2zm0 7h12v2H3v-2z',
  },
  'official homepage': {
    viewBox: '0 0 24 24',
    path: 'M12 2L2 12h3v8h6v-6h2v6h6v-8h3L12 2z',
  },
}