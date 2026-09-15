import type { ReleaseTypeBucketId } from '~/types/stats'

// Mutually-exclusive classification of a LocalRelease into one Release Types bucket. Priority order
// (box-set beats compilation beats live, ...) matches helpers/constants.ts's releaseTypeBuckets array -
// keep both in sync. "Other" MB primary types fold into 'unknown' (no local release has ever matched
// one - not worth its own tab).
//
// Caveat baked into the data, not worked around here: db.rs's upsert never clears
// releaseGroupSecondaryTypes with an empty incoming array, so a release last synced before
// 2026-09-08 can read `[]` even if MB says otherwise, and lands in 'ep'/'single'/'album' instead of
// 'compilation'/'live'/'soundtrack'. A `./sync --overwrite` fixes it. These counts are "best known",
// not authoritative.
export interface ReleaseTypeClassifyInput {
  typeSlug: string | null
  secondaryTypes: string[]
  mediumCount: number | null
  packaging: string | null
}

export const classifyReleaseType = (r: ReleaseTypeClassifyInput): ReleaseTypeBucketId => {
  if (r.typeSlug === null) { return 'unknown' }
  if ((r.mediumCount ?? 1) >= 3 || r.packaging === 'Box') { return 'box-set' }
  if (r.secondaryTypes.includes('Compilation')) { return 'compilation' }
  if (r.secondaryTypes.includes('Live')) { return 'live' }
  if (r.secondaryTypes.includes('Soundtrack')) { return 'soundtrack' }
  if (r.typeSlug === 'ep') { return 'ep' }
  if (r.typeSlug === 'single') { return 'single' }
  if (r.typeSlug === 'album') { return 'album' }
  return 'unknown'
}

// SQL equivalent of classifyReleaseType, for use in raw queries that need to GROUP BY / WHERE on the
// bucket without pulling every release into Node. Assumes the caller already joined:
//   LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
//   LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
export const releaseTypeBucketSql = `
  CASE
    WHEN lr."releaseId" IS NULL THEN 'unknown'
    WHEN mb."mediumCount" >= 3 OR mb."packaging" = 'Box' THEN 'box-set'
    WHEN 'Compilation' = ANY(mb."releaseGroupSecondaryTypes") THEN 'compilation'
    WHEN 'Live' = ANY(mb."releaseGroupSecondaryTypes") THEN 'live'
    WHEN 'Soundtrack' = ANY(mb."releaseGroupSecondaryTypes") THEN 'soundtrack'
    WHEN rt."slug" = 'ep' THEN 'ep'
    WHEN rt."slug" = 'single' THEN 'single'
    WHEN rt."slug" = 'album' THEN 'album'
    ELSE 'unknown'
  END
`.trim()
