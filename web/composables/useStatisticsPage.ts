import { LucideLibrary, LucidePlay, LucideRefreshCw, LucideImage, LucideAlertTriangle, LucideDisc3 } from 'lucide-vue-next'
import type { Statistics, StatSection, StatTile } from '~/types/stats'
import { browserTimeZone, formatNumber, formatFileSize } from '~/helpers/functions'
import { releaseTypeBuckets } from '~/helpers/constants'

// State behind pages/statistics/index.vue: the /api/stats payload (in the listener's time zone) and the tiles and
// sections built from it.
export const useStatisticsPage = () => {
  const api = useApi()
  const loading = ref(true)
  const stats = ref<Statistics | null>(null)

  const tiles = computed<StatTile[]>(() => {
    const s = stats.value

    if (!s) {
      return []
    }

    return [
      { label: 'Artists', value: formatNumber(s.mainArtists), icon: LucideLibrary, link: '/statistics/artists' },
      { label: 'Releases', value: formatNumber(s.releases), icon: LucideImage, link: '/statistics/releases' },
      { label: 'Tracks', value: formatNumber(s.tracks), icon: LucideRefreshCw, link: '/statistics/tracks' },
      { label: 'Total plays', value: formatNumber(s.plays), icon: LucidePlay, link: '/statistics/plays' },
    ]
  })

  const sections = computed<StatSection[]>(() => {
    const s = stats.value
    if (!s) { return [] }
    return [
      {
        title: 'Library',
        icon: LucideLibrary,
        items: [
          { label: 'Artists synced', value: formatNumber(s.artistsSyncedWithMusicbrainz), link: '/statistics/artists-synced' },
          { label: 'Releases synced', value: formatNumber(s.releasesSyncedWithMusicbrainz), link: '/statistics/releases-synced' },
          { label: 'Linked artists', value: formatNumber(s.linkedArtists), info: 'Artists that share a MusicBrainz ID with another artist (e.g. "Artist A & B" → "Artist A"). Their catalogue is aggregated on the primary artist\'s page.' },
          { label: 'Artists with photo', value: formatNumber(s.artistsWithCoverArt), link: '/statistics/artists-with-art' },
          { label: 'Releases with cover art', value: formatNumber(s.releasesWithCoverArt), link: '/statistics/releases-with-art' },
          { label: 'Genres', value: formatNumber(s.genres), link: '/statistics/genres' },
          { label: 'Total size', value: formatFileSize(s.totalFileSize), link: '/statistics/size' },
        ],
      },
      {
        title: 'Release Types',
        icon: LucideDisc3,
        items: releaseTypeBuckets.map(b => ({
          label: b.label,
          value: formatNumber(s.releaseTypes[b.id]),
          link: `/statistics/types?sort=${b.id}`,
        })),
      },
      {
        title: 'Curation',
        icon: LucideAlertTriangle,
        warn: true,
        items: [
          { label: 'Unmatched releases', value: formatNumber(s.unmatchedReleases), link: '/statistics/unmatched' },
          { label: 'Incomplete releases', value: formatNumber(s.incompleteReleases), link: '/statistics/incomplete' },
          { label: 'Low bitrate tracks', value: formatNumber(s.lowBitrateTracks), link: '/statistics/bitrate' },
          { label: 'Single-release artists', value: formatNumber(s.singleReleaseArtists), link: '/statistics/single-release' },
          { label: 'Missing cover art', value: formatNumber(s.missingArtReleases), link: '/statistics/missing-art' },
          { label: 'Shortest releases', value: 'Browse', link: '/statistics/shortest' },
        ],
      },
    ]
  })

  const load = async () => {
    loading.value = true
    try {
      stats.value = await $fetch<Statistics>('/api/stats', { query: { tz: browserTimeZone() } })
    }
    catch (e) {
      api.report(e, 'Could not load the statistics')
    }
    finally {
      loading.value = false
    }
  }

  onMounted(load)

  return { loading, stats, tiles, sections }
}
