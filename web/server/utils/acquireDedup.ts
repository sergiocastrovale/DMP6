// What to do with `replacesLocalReleaseId` when an acquisition lands on a DownloadedRelease row
// that is already in flight for the same release group.
//
// Several LocalReleases can share one release group - duplicate folder copies of an album, or disc
// halves that have not been merged yet - so "re-download this copy" can arrive twice for the same
// in-flight row with two different targets. The field decides which folder the merge DELETES, so
// overwriting it silently destroys a copy the user never pointed at. An empty field is safe to fill
// (the row predates the click and knows nothing about the copy it should replace); a field already
// naming a different copy is left exactly as it is, and the caller says so.

export interface ReplaceTargetDecision {
  /** Write `requested` onto the existing row. */
  stamp: boolean
  /** The row is already committed to replacing a *different* local copy. */
  otherCopyInFlight: boolean
}

export const resolveReplaceTarget = (
  existing: string | null | undefined,
  requested: string | null | undefined,
): ReplaceTargetDecision => {
  if (!requested) {
    return { stamp: false, otherCopyInFlight: false }
  }
  if (!existing) {
    return { stamp: true, otherCopyInFlight: false }
  }
  return { stamp: false, otherCopyInFlight: existing !== requested }
}
