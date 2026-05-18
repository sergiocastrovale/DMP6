import { prisma } from '~/server/utils/prisma'

const PEOPLE_KEYS = [
  'Composer', 'ComposerSortOrder',
  'Conductor', 'CONDUCTOR_SORT',
  'Producer', 'PRODUCER',
  'Engineer', 'ENGINEER',
  'Lyricist', 'LYRICIST_SORT',
  'Remixer',
  'Arranger', 'ARRANGER',
  'MixEngineer', 'MIXER',
  'MASTERING',
  'RECORDING_ENGINEER',
  'SOUND_ENGINEER',
  'PERFORMER', 'PERFORMER_NAME',
]

const PEOPLE_LABELS: Record<string, string> = {
  Composer: 'Composer',
  ComposerSortOrder: 'Composer',
  Conductor: 'Conductor',
  CONDUCTOR_SORT: 'Conductor',
  Producer: 'Producer',
  PRODUCER: 'Producer',
  Engineer: 'Engineer',
  ENGINEER: 'Engineer',
  Lyricist: 'Lyricist',
  LYRICIST_SORT: 'Lyricist',
  Remixer: 'Remixer',
  Arranger: 'Arranger',
  ARRANGER: 'Arranger',
  MixEngineer: 'Mix engineer',
  MIXER: 'Mix engineer',
  MASTERING: 'Mastering',
  RECORDING_ENGINEER: 'Recording engineer',
  SOUND_ENGINEER: 'Sound engineer',
  PERFORMER: 'Performer',
  PERFORMER_NAME: 'Performer',
}

const collectDistinct = (tracks: { metadata: unknown }[], keys: string[]): string | null => {
  const values = new Set<string>()
  for (const t of tracks) {
    const meta = t.metadata as Record<string, unknown> | null
    if (!meta) { continue }
    for (const key of keys) {
      const val = meta[key]
      if (typeof val === 'string' && val.trim()) {
        values.add(val.trim())
      }
    }
  }
  return values.size ? [...values].sort().join(', ') : null
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const release = await prisma.localRelease.findUnique({
    where: { id },
    select: {
      id: true,
      tracks: {
        select: { genre: true, metadata: true },
      },
    },
  })

  if (!release) {
    throw createError({ statusCode: 404, statusMessage: 'Release not found' })
  }

  const genres = [...new Set(
    release.tracks
      .map(t => t.genre)
      .filter((g): g is string => !!g && g.trim() !== ''),
  )].sort()

  const bpm = collectDistinct(release.tracks, ['IntegerBpm'])
  const originalReleaseDate = collectDistinct(release.tracks, ['OriginalReleaseDate', 'ORIGINALRELEASEDATE', 'originalyear'])
  const country = collectDistinct(release.tracks, ['Country', 'COUNTRY', 'RELEASECOUNTRY', 'MusicBrainz Album Release Country'])
  const label = collectDistinct(release.tracks, ['Label', 'LABEL'])
  const isrc = collectDistinct(release.tracks, ['Isrc'])

  const people: Record<string, string[]> = {}
  for (const track of release.tracks) {
    const meta = track.metadata as Record<string, unknown> | null
    if (!meta) { continue }
    for (const key of PEOPLE_KEYS) {
      const val = meta[key]
      if (typeof val === 'string' && val.trim()) {
        const role = PEOPLE_LABELS[key] ?? key
        if (!people[role]) { people[role] = [] }
        if (!people[role].includes(val.trim())) {
          people[role].push(val.trim())
        }
      }
    }
  }

  return { genres, bpm, originalReleaseDate, country, label, isrc, people }
})
