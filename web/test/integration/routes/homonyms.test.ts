import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { artistFolderName, countUnidentifiedMembers, homonymMembers, homonymStampArgs, homonymToken, listUnidentifiedMembers, resolveArtistSlug, withHomonymNotes } from '../../../server/utils/homonyms'

vi.mock('../../../server/utils/images', () => ({
  verifyImage: (image: string | null, imageUrl: string | null) => ({ image, imageUrl }),
}))

// What `/artist/<slug>` means once two artists can share a name (docs/sync_decisions.md "Two artists, one name"), read
// against real rows shaped the way the scripts leave them.
const prisma = getTestPrisma()

const artist = (name: string, slug: string, baseSlug: string, extra: Record<string, unknown> = {}) =>
  prisma.artist.create({ data: { name, slug, baseSlug, ...extra } })

const own = async (artistId: string, n: number) => {
  for (let i = 0; i < n; i++) {
    const release = await prisma.localRelease.create({ data: { title: `R${i}`, groupKey: `folder:homonyms/${artistId}/${i}` } })
    await prisma.localReleaseArtist.create({ data: { localReleaseId: release.id, artistId } })
  }
}

describe('homonym slugs (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('an artist\'s own slug is that artist', async () => {
    await artist('Radiohead', 'radiohead', 'radiohead')
    expect(await resolveArtistSlug('radiohead')).toEqual({ kind: 'artist' })
  })

  it('the bare slug of a shared name is the chooser, most-owned first', async () => {
    const pt = await artist('NAPA', 'napa-d76eeba7', 'napa', { musicbrainzId: 'd76eeba7-x', country: 'PT', disambiguation: 'Portuguese band' })
    const kr = await artist('Napa', 'napa-9f3423ee', 'napa', { musicbrainzId: '9f3423ee-x', country: 'KR' })
    await own(pt.id, 1)
    await own(kr.id, 2)

    const r = await resolveArtistSlug('napa')
    expect(r.kind).toBe('chooser')
    if (r.kind === 'chooser') {
      expect(r.members.map(m => m.slug)).toEqual(['napa-9f3423ee', 'napa-d76eeba7'])
      expect(r.members[1]).toMatchObject({ country: 'PT', disambiguation: 'Portuguese band', releaseCount: 1, musicbrainzId: 'd76eeba7-x' })
    }
    expect((await homonymMembers('napa', pt.id)).map(m => m.id)).toEqual([kr.id])
  })

  it('an old slug redirects to the artist\'s current one', async () => {
    const pt = await artist('NAPA', 'napa-d76eeba7', 'napa')
    await artist('Napa', 'napa-9f3423ee', 'napa')
    await prisma.artistSlugHistory.create({ data: { oldSlug: 'napa-old', artistId: pt.id } })
    expect(await resolveArtistSlug('napa-old')).toEqual({ kind: 'redirect', slug: 'napa-d76eeba7' })
  })

  it('the base of a name only one artist has now redirects to it', async () => {
    await artist('NAPA', 'napa-d76eeba7', 'napa')
    expect(await resolveArtistSlug('napa')).toEqual({ kind: 'redirect', slug: 'napa-d76eeba7' })
  })

  it('a connected duplicate is not a member, and an unknown slug is missing', async () => {
    const pt = await artist('NAPA', 'napa', 'napa')
    await artist('Napa', 'napa-dup', 'napa', { primaryArtistId: pt.id })
    expect(await homonymMembers('napa')).toHaveLength(1)
    expect(await resolveArtistSlug('nobody')).toEqual({ kind: 'missing' })
  })

  it('lists show what tells same-named artists apart, and nothing for a name only one artist has', async () => {
    await artist('NAPA', 'napa-d76eeba7', 'napa', { country: 'PT', disambiguation: 'Portuguese band' })
    await artist('Napa', 'napa-9f3423ee', 'napa')
    await artist('Radiohead', 'radiohead', 'radiohead', { country: 'GB' })
    const rows = await prisma.artist.findMany({ select: { slug: true, baseSlug: true, country: true, disambiguation: true }, orderBy: { slug: 'asc' } })
    const noted = await withHomonymNotes(rows)
    expect(noted).toEqual([
      { slug: 'napa-9f3423ee', homonymNote: 'Not yet identified' },
      { slug: 'napa-d76eeba7', homonymNote: 'Portuguese band · Portugal' },
      { slug: 'radiohead', homonymNote: null },
    ])
  })

  it('the ambiguous-artists issue lists each shared name\'s unidentified member', async () => {
    await artist('NAPA', 'napa-d76eeba7', 'napa', { musicbrainzId: 'd76eeba7-x' })
    const unknown = await artist('Napa', 'napa-cxyz1234', 'napa')
    await own(unknown.id, 2)
    await artist('Lonely', 'lonely', 'lonely')
    expect(await countUnidentifiedMembers()).toBe(1)
    const [rows, total] = await listUnidentifiedMembers(0, 50)
    expect(total).toBe(1)
    expect(rows[0]).toMatchObject({ id: unknown.id, artist: { name: 'Napa', slug: 'napa-cxyz1234' }, releaseCount: 2, groupSize: 2, baseSlug: 'napa' })
    expect((await listUnidentifiedMembers(0, 50, 'nobody'))[1]).toBe(0)
  })

  it('a download for a homonym gets its own folder and has its files stamped; a lone artist gets neither', async () => {
    const pt = await artist('NAPA', 'napa-d76eeba7', 'napa', { musicbrainzId: 'd76eeba7-d35c-4fe8-bffa-ce2885c97765' })
    await artist('Napa', 'napa-9f3423ee', 'napa', { musicbrainzId: '9f3423ee-debe-48ec-b78d-281438aaf626' })
    const lone = await artist('Radiohead', 'radiohead', 'radiohead', { musicbrainzId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' })

    expect(await artistFolderName(pt.id, 'NAPA')).toBe('NAPA (d76eeba7)')
    expect(await artistFolderName(lone.id, 'Radiohead')).toBe('Radiohead')
    expect(await artistFolderName(null, 'Anyone')).toBe('Anyone')
    expect(await homonymStampArgs(pt.id, 'NAPA (d76eeba7)/Album/2019 - X'))
      .toEqual(['--assign-artist', '--folder', 'NAPA (d76eeba7)/Album/2019 - X', '--mbid', 'd76eeba7-d35c-4fe8-bffa-ce2885c97765'])
    expect(await homonymStampArgs(lone.id, 'Radiohead/Album/1997 - OK Computer')).toBeNull()
  })

  it('the token is the first 8 of the MusicBrainz id, else of the artist id', () => {
    expect(homonymToken('d76eeba7-d35c-4fe8-bffa-ce2885c97765', 'x')).toBe('d76eeba7')
    expect(homonymToken(null, 'mjv481qlssilj6aztekqbe9c')).toBe('mjv481ql')
  })
})
