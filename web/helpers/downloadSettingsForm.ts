export type Choice = 'default' | 'on' | 'off'

// null (or undefined) in the settings row means "use the environment default".
export const triState = (v: boolean | null | undefined): Choice =>
  v === null || v === undefined ? 'default' : v ? 'on' : 'off'

export const fromChoice = (c: Choice): boolean | null => c === 'default' ? null : c === 'on'

// A number input keeps its value as a string; an empty one means "use the default" and is sent as null.
export const toNull = (v: string): number | null => v === '' ? null : Number(v)

export const numberInput = (v: unknown): string => (v ?? '') === '' ? '' : String(v)

export interface MonitoringField {
  key: 'maxConcurrentDownloads' | 'searchPicksPerInterval' | 'searchIntervalSec' | 'gapsPicksPerRun' | 'gapsIntervalMin' | 'retryCooldownDays' | 'noProgressSec' | 'maxDownloadAttempts'
  label: string
  description: string
  placeholder: string
}

// The numeric downloader/monitor knobs, in the order the form shows them. Each falls back to its environment variable
// (named in the description) when blank.
export const MONITORING_FIELDS: readonly MonitoringField[] = [
  { key: 'maxConcurrentDownloads', label: 'Max concurrent downloads', placeholder: '5', description: 'Cap on simultaneous active Soulseek transfers. The worker tops up to this. Default 5. (MAX_CONCURRENT_DOWNLOADS)' },
  { key: 'searchPicksPerInterval', label: 'Search picks per interval', placeholder: '3', description: 'How many new missing releases the worker searches each top-up. Default 3. (SEARCH_PICKS_PER_INTERVAL)' },
  { key: 'searchIntervalSec', label: 'Search interval (seconds)', placeholder: '60', description: 'Minimum seconds between download top-up runs (throttle). Default 60. (SEARCH_INTERVAL_SEC)' },
  { key: 'gapsPicksPerRun', label: 'Catalogue-gap picks per run', placeholder: '20', description: 'Monitored artists whose MusicBrainz catalogue is refreshed each gap run (round-robin). Default 20. (GAPS_PICKS_PER_RUN)' },
  { key: 'gapsIntervalMin', label: 'Catalogue-gap interval (minutes)', placeholder: '5', description: 'Minutes between catalogue-gap runs. Default 5. (GAPS_INTERVAL_MIN)' },
  { key: 'retryCooldownDays', label: 'Retry cooldown (days)', placeholder: '7', description: 'Wait this many days before retrying a FAILED/UNAVAILABLE/INVALID release. Default 7. (RETRY_COOLDOWN_DAYS)' },
  { key: 'noProgressSec', label: 'No-progress timeout (seconds)', placeholder: '60', description: 'Kill a download making no byte progress for this long. Default 60. (NO_PROGRESS_SEC)' },
  { key: 'maxDownloadAttempts', label: 'Max attempts before giving up', placeholder: '3', description: 'After this many failed attempts a release is abandoned (never auto-retried). Default 3. (MAX_DOWNLOAD_ATTEMPTS)' },
]

export interface DownloadSettingsFormState {
  form: {
    slskdUrl: string
    slskdApiKey: string
    downloadsPath: string
    downloadDirTemplate: string
    downloadFormats: string
    downloadMinBitrate: string
  }
  monitoring: Record<MonitoringField['key'], string>
  choices: {
    downloadsEnabled: Choice
    flacToMp3: Choice
    monitorEnabled: Choice
    songkongEnabled: Choice
    autoMergeDownloads: Choice
  }
  flacToMp3Bitrate: string
}

// The PUT /api/settings body for the whole downloads page. A blank text field is sent as null (use the env default),
// except the API key, where blank means "keep the stored one" and is left out.
export const buildDownloadSettingsBody = ({ form, monitoring, choices, flacToMp3Bitrate }: DownloadSettingsFormState) => ({
  slskdUrl: form.slskdUrl || null,
  slskdApiKey: form.slskdApiKey || undefined,
  downloadsPath: form.downloadsPath || null,
  downloadDirTemplate: form.downloadDirTemplate || null,
  downloadFormats: form.downloadFormats || null,
  downloadMinBitrate: Number(form.downloadMinBitrate),
  downloadsEnabled: fromChoice(choices.downloadsEnabled),
  flacToMp3: fromChoice(choices.flacToMp3),
  flacToMp3Bitrate: Number(flacToMp3Bitrate),
  monitorEnabled: fromChoice(choices.monitorEnabled),
  songkongEnabled: fromChoice(choices.songkongEnabled),
  autoMergeDownloads: fromChoice(choices.autoMergeDownloads),
  ...Object.fromEntries(MONITORING_FIELDS.map(f => [f.key, toNull(monitoring[f.key])])),
})
