import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import type { ArtistHomonym } from '~/types/artist'
import { homonymNote } from '~/helpers/homonyms'

// Two artists, one name (docs/sync_decisions.md "Two artists, one name"). The scripts keep every name's group in shape
// (scripts/common/src/homonyms.rs): one artist holds its bare slug, two or more each hold `{base}-{id}` and the bare
// slug is a chooser page. This is the web side of that: what a slug in a URL means, and who shares a name.

export type ArtistSlugResolution =
  | { kind: 'artist' }
  | { kind: 'chooser', members: ArtistHomonym[] }
  | { kind: 'redirect', slug: string }
  | { kind: 'missing' }

const MEMBER_SELECT = {
  id: true,
  name: true,
  slug: true,
  musicbrainzId: true,
  country: true,
  disambiguation: true,
  image: true,
  imageUrl: true,
  _count: { select: { localReleases: true } },
} as const

// The primary artists sharing a base slug, most-owned first - the chooser's cards and the header's "Also named" chips.
export const homonymMembers = async (baseSlug: string, exceptId?: string): Promise<ArtistHomonym[]> => {
  const rows = await prisma.artist.findMany({
    where: { baseSlug, primaryArtistId: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: MEMBER_SELECT,
  })
  return rows
    .map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      musicbrainzId: r.musicbrainzId,
      country: r.country,
      disambiguation: r.disambiguation,
      releaseCount: r._count.localReleases,
      ...verifyImage(r.image, r.imageUrl, 'artists'),
    }))
    .sort((a, b) => b.releaseCount - a.releaseCount || a.slug.localeCompare(b.slug))
}

// What `/artist/<slug>` shows, in order: the artist holding that slug; the chooser, when the slug is a base two or more
// artists share; a redirect, when the slug is one an artist used to have, or the base of a name only one artist has.
export const resolveArtistSlug = async (slug: string): Promise<ArtistSlugResolution> => {
  const exact = await prisma.artist.findUnique({ where: { slug }, select: { id: true } })
  if (exact) {
    return { kind: 'artist' }
  }
  const members = await homonymMembers(slug)
  if (members.length > 1) {
    return { kind: 'chooser', members }
  }
  const history = await prisma.artistSlugHistory.findUnique({ where: { oldSlug: slug }, select: { artist: { select: { slug: true } } } })
  if (history) {
    return { kind: 'redirect', slug: history.artist.slug }
  }
  if (members.length === 1) {
    return { kind: 'redirect', slug: members[0]!.slug }
  }
  return { kind: 'missing' }
}

// Which of these base slugs are shared by two or more artists - so a list only spends room on "which one" where it
// matters.
export const sharedBaseSlugs = async (baseSlugs: (string | null)[]): Promise<Set<string>> => {
  const wanted = [...new Set(baseSlugs.filter((b): b is string => !!b))]
  if (wanted.length === 0) {
    return new Set()
  }
  const rows = await prisma.artist.groupBy({
    by: ['baseSlug'],
    where: { baseSlug: { in: wanted }, primaryArtistId: null },
    _count: { _all: true },
  })
  return new Set(rows.filter(r => r._count._all > 1 && r.baseSlug).map(r => r.baseSlug!))
}

// The fields a list needs to tell same-named artists apart.
export const HOMONYM_SELECT = { baseSlug: true, country: true, disambiguation: true } as const

interface HomonymFields {
  baseSlug: string | null
  country: string | null
  disambiguation: string | null
}

// Drops the homonym fields from each row and adds `homonymNote`: what tells it apart ("Portuguese band · Portugal") when
// another artist in the library has the same name, null otherwise.
export const withHomonymNotes = async <T extends HomonymFields>(rows: T[]): Promise<(Omit<T, keyof HomonymFields> & { homonymNote: string | null })[]> => {
  const shared = await sharedBaseSlugs(rows.map(r => r.baseSlug))
  return rows.map(({ baseSlug, country, disambiguation, ...rest }) => ({
    ...rest,
    homonymNote: baseSlug && shared.has(baseSlug) ? homonymNote({ country, disambiguation }) ?? 'Not yet identified' : null,
  }))
}

// Every name group's unidentified member: an artist that shares its name with others and could not be matched to a
// MusicBrainz artist, holding the releases no file id or catalogue places. The /issues "Ambiguous artists" list -
// read live from the artist rows, it has no table of its own.
export interface UnidentifiedMember {
  id: string
  artist: { name: string, slug: string }
  releaseCount: number
  groupSize: number
  baseSlug: string
}

const UNIDENTIFIED_WHERE = Prisma.sql`
  a."primaryArtistId" IS NULL AND NULLIF(a."musicbrainzId", '') IS NULL
  AND (SELECT count(*) FROM "Artist" o WHERE o."baseSlug" = a."baseSlug" AND o."primaryArtistId" IS NULL) > 1`

export const countUnidentifiedMembers = async (): Promise<number> => {
  const [row] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Artist" a WHERE ${UNIDENTIFIED_WHERE}`
  return row?.n ?? 0
}

export const listUnidentifiedMembers = async (skip: number, take: number, q?: string): Promise<[UnidentifiedMember[], number]> => {
  const search = q ? Prisma.sql`AND a.name ILIKE ${`%${q}%`}` : Prisma.empty
  const rows = await prisma.$queryRaw<{ id: string, name: string, slug: string, baseSlug: string, releases: number, members: number, total: number }[]>`
    SELECT a.id, a.name, a.slug, a."baseSlug",
           (SELECT count(*)::int FROM "LocalReleaseArtist" l WHERE l."artistId" = a.id) AS releases,
           (SELECT count(*)::int FROM "Artist" o WHERE o."baseSlug" = a."baseSlug" AND o."primaryArtistId" IS NULL) AS members,
           count(*) OVER()::int AS total
    FROM "Artist" a
    WHERE ${UNIDENTIFIED_WHERE} ${search}
    ORDER BY a.name, a.id
    OFFSET ${skip} LIMIT ${take}`
  return [
    rows.map(r => ({ id: r.id, artist: { name: r.name, slug: r.slug }, releaseCount: r.releases, groupSize: r.members, baseSlug: r.baseSlug })),
    rows[0]?.total ?? 0,
  ]
}

// The id token a homonym's slug and folder carry: the first 8 characters of its MusicBrainz id, else of its Artist id
// - the same token scripts/common/src/homonyms.rs puts in the slug and ./add in the folder name.
export const homonymToken = (musicbrainzId: string | null, artistId: string): string =>
  (musicbrainzId || artistId).replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()

// The folder a download for this artist lands in: its name, or - while other artists share the name - `Name (token)`,
// so two same-named artists never share a directory.
export const artistFolderName = async (artistId: string | null | undefined, name: string): Promise<string> => {
  if (!artistId) {
    return name
  }
  const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { baseSlug: true, musicbrainzId: true } })
  if (!artist?.baseSlug || !(await sharedBaseSlugs([artist.baseSlug])).has(artist.baseSlug)) {
    return name
  }
  return `${name} (${homonymToken(artist.musicbrainzId, artistId)})`
}

// A download for an artist that shares its name: write that artist's MusicBrainz id into the files it brought
// (./fix --assign-artist), so the index files them under the right artist instead of reading the name alone. Returns
// the fix arguments, or null when nothing needs stamping (a name only one artist has, or an artist without an id).
export const homonymStampArgs = async (artistId: string | null | undefined, folder: string): Promise<string[] | null> => {
  if (!artistId) {
    return null
  }
  const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { baseSlug: true, musicbrainzId: true } })
  if (!artist?.musicbrainzId || !artist.baseSlug || !(await sharedBaseSlugs([artist.baseSlug])).has(artist.baseSlug)) {
    return null
  }
  return ['--assign-artist', '--folder', folder, '--mbid', artist.musicbrainzId]
}
