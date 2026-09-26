import { prisma } from '~/server/utils/prisma'
import type { IssueType } from '~/types/issues'

export type IssueStatus = 'DETECTED' | 'PENDING' | 'PENDING_REVERT' | 'RESOLVED' | 'FAILED'

// The slice of a Prisma model delegate the issue endpoints use. Seven tables share this shape (status, createdAt,
// updatedAt) without sharing a Prisma type, so each is narrowed to it once, here, instead of an `as any` per endpoint.
export interface IssueDelegate {
  count: (args: { where: { status: IssueStatus } }) => Promise<number>
  update: (args: { where: { id: string }, data: Record<string, unknown> }) => Promise<unknown>
  updateMany: (args: { where: { id: { in: string[] }, status: IssueStatus }, data: { status: IssueStatus, updatedAt: Date } }) => Promise<{ count: number }>
}

export interface IssueTypeDef {
  id: IssueType
  label: string
  delegate: IssueDelegate
  // Flows through the queue / patch endpoints (the audit-only types are only ever read and counted).
  fixable: boolean
  // Has FixHistory rows and can be sent back to PENDING_REVERT.
  revertable: boolean
  // Columns a PATCH may set on a row of this type.
  patchableFields: readonly string[]
}

const asDelegate = (model: unknown): IssueDelegate => model as IssueDelegate

// The single list of issue types. Order is the order the UI shows them in.
export const ISSUE_TYPES: readonly IssueTypeDef[] = [
  { id: 'corrupted', label: 'Corrupted tags', delegate: asDelegate(prisma.issueCorruptedTpe2), fixable: true, revertable: true, patchableFields: ['proposedValue'] },
  { id: 'orphans', label: 'Orphan artists', delegate: asDelegate(prisma.issueOrphanArtist), fixable: true, revertable: false, patchableFields: [] },
  { id: 'duplicates', label: 'Duplicate artists', delegate: asDelegate(prisma.issueDuplicateArtist), fixable: true, revertable: false, patchableFields: [] },
  { id: 'missing', label: 'Missing metadata', delegate: asDelegate(prisma.issueMissingMetadata), fixable: true, revertable: true, patchableFields: ['proposedValues'] },
  { id: 'enrichment', label: 'Enrichment gaps', delegate: asDelegate(prisma.issueEnrichmentGap), fixable: false, revertable: false, patchableFields: [] },
  { id: 'duplicate-release', label: 'Duplicate releases', delegate: asDelegate(prisma.issueDuplicateRelease), fixable: false, revertable: false, patchableFields: [] },
  { id: 'mismatched-release-id', label: 'Mismatched release ids', delegate: asDelegate(prisma.issueMismatchedReleaseId), fixable: false, revertable: false, patchableFields: [] },
]

const BY_ID = new Map<string, IssueTypeDef>(ISSUE_TYPES.map(t => [t.id, t]))

export const findIssueType = (id: string | undefined): IssueTypeDef | undefined => (id ? BY_ID.get(id) : undefined)

export const isIssueType = (id: string | undefined): id is IssueType => !!id && BY_ID.has(id)

// A type that passes the predicate, or the 404/400 the endpoint would otherwise hand-roll.
export const requireIssueType = (
  id: string | undefined,
  { fixable, revertable }: { fixable?: boolean, revertable?: boolean } = {},
): IssueTypeDef => {
  const def = findIssueType(id)
  if (!def) {
    throw createError({ statusCode: 404, message: `Unknown issue type: ${id}` })
  }
  if (fixable && !def.fixable) {
    throw createError({ statusCode: 404, message: `Unknown issue type: ${id}` })
  }
  if (revertable && !def.revertable) {
    throw createError({ statusCode: 400, message: `Revert not supported for type: ${id}` })
  }
  return def
}

// How many rows of every type sit in `status`, keyed by type id.
export const countByStatus = async (status: IssueStatus): Promise<Record<IssueType, number>> => {
  const counts = await Promise.all(ISSUE_TYPES.map(t => t.delegate.count({ where: { status } })))
  return Object.fromEntries(ISSUE_TYPES.map((t, i) => [t.id, counts[i]!])) as Record<IssueType, number>
}
