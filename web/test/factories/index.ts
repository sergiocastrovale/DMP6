import { randomUUID } from 'node:crypto'
import type { PrismaClient, Prisma, Role } from '@prisma/client'
import { getTestPrisma } from '../setup/db'

const uid = (prefix: string): string => `${prefix}-${randomUUID().slice(0, 8)}`

export const makeUser = (
  prisma: PrismaClient,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
) => prisma.user.create({
  data: {
    username: uid('user'),
    email: `${uid('user')}@test.local`,
    passwordHash: '$2b$12$test.hash.not.a.real.bcrypt.hash.padding.xxxxxxxxxxxx',
    role: 'VIEWER' as Role,
    mustChangePassword: false,
    ...overrides,
  },
})

export const makeReleaseType = (prisma: PrismaClient, overrides: { name?: string } = {}) => {
  const name = overrides.name ?? 'Album'
  return prisma.releaseType.upsert({
    where: { name },
    create: { name, slug: name.toLowerCase() },
    update: {},
  })
}

export const makeArtist = (
  prisma: PrismaClient,
  overrides: Partial<Prisma.ArtistUncheckedCreateInput> = {},
) => prisma.artist.create({
  data: {
    name: uid('Artist'),
    slug: uid('artist'),
    ...overrides,
  },
})

export const makeMbRelease = async (
  prisma: PrismaClient,
  overrides: Partial<Prisma.MusicBrainzReleaseUncheckedCreateInput> = {},
) => {
  const type = await makeReleaseType(prisma)
  return prisma.musicBrainzRelease.create({
    data: {
      title: uid('Release'),
      musicbrainzId: uid('mb'),
      typeId: type.id,
      year: 2020,
      status: 'MISSING',
      ...overrides,
    },
  })
}

export const makeMbTrack = (
  prisma: PrismaClient,
  releaseId: string,
  overrides: Partial<Prisma.MusicBrainzReleaseTrackUncheckedCreateInput> = {},
) => prisma.musicBrainzReleaseTrack.create({
  data: {
    title: uid('Track'),
    position: 1,
    releaseId,
    ...overrides,
  },
})

export const makeLocalRelease = (
  prisma: PrismaClient,
  overrides: Partial<Prisma.LocalReleaseUncheckedCreateInput> = {},
) => prisma.localRelease.create({
  data: {
    title: uid('Local Release'),
    groupKey: uid('meta'),
    year: 2020,
    matchStatus: 'UNMATCHED',
    ...overrides,
  },
})

export const makeLocalTrack = (
  prisma: PrismaClient,
  overrides: Partial<Prisma.LocalReleaseTrackUncheckedCreateInput> = {},
) => prisma.localReleaseTrack.create({
  data: {
    title: uid('Track'),
    filePath: `/music/${uid('file')}.flac`,
    trackNumber: 1,
    ...overrides,
  },
})

export const makeDownloadedRelease = (
  prisma: PrismaClient,
  overrides: Partial<Prisma.DownloadedReleaseUncheckedCreateInput> = {},
) => prisma.downloadedRelease.create({
  data: {
    title: uid('Downloaded Release'),
    year: 2020,
    source: 'SLSKD',
    status: 'DOWNLOADING',
    ...overrides,
  },
})

export const makePlaylist = (
  prisma: PrismaClient,
  overrides: Partial<Prisma.PlaylistUncheckedCreateInput> = {},
) => prisma.playlist.create({
  data: {
    name: uid('Playlist'),
    slug: uid('playlist'),
    type: 'MANUAL',
    ...overrides,
  },
})

export const makeAuditRun = (prisma: PrismaClient) => prisma.auditRun.create({ data: {} })

export const makeIssueCorrupted = async (
  prisma: PrismaClient,
  trackId: string,
  overrides: Partial<Prisma.IssueCorruptedTpe2UncheckedCreateInput> = {},
) => {
  const run = await makeAuditRun(prisma)
  return prisma.issueCorruptedTpe2.create({
    data: {
      auditRunId: run.id,
      trackId,
      currentValue: 'Bad\x00Value',
      proposedValue: 'Bad Value',
      confidence: 'high',
      status: 'DETECTED',
      ...overrides,
    },
  })
}

export const makeIssueDuplicateRelease = async (
  prisma: PrismaClient,
  releaseAId: string,
  releaseBId: string,
  overrides: Partial<Prisma.IssueDuplicateReleaseUncheckedCreateInput> = {},
) => {
  const run = await makeAuditRun(prisma)
  return prisma.issueDuplicateRelease.create({
    data: {
      auditRunId: run.id,
      releaseAId,
      releaseBId,
      status: 'DETECTED',
      ...overrides,
    },
  })
}

export const makeIssueMismatchedReleaseId = async (
  prisma: PrismaClient,
  releaseAId: string,
  releaseBId: string,
  overrides: Partial<Prisma.IssueMismatchedReleaseIdUncheckedCreateInput> = {},
) => {
  const run = await makeAuditRun(prisma)
  return prisma.issueMismatchedReleaseId.create({
    data: {
      auditRunId: run.id,
      releaseAId,
      releaseBId,
      status: 'DETECTED',
      ...overrides,
    },
  })
}

export { uid }
