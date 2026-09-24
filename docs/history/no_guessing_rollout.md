# No-guessing release placement — rollout log

Dated rollout record for the no-guessing consensus gate (`scripts/common/src/consensus.rs`), split out
of `docs/no_guessing.md` to keep that file a pure current-behavior reference. No code cites this file
by section number — it's pure history, kept for anyone reconstructing why a specific count looks the
way it does.

## Status

Shipped, implemented, tested, committed, deployed, and the one-off ran against production — preview
numbers matched the post-run count exactly (roughly 16,800 releases flagged, around 5,000 of them
previously `COMPLETE`). See `docs/specs/spec_tidy_observations.md` §19 "Round 8" for the confirmed
final counts and reason split. Undo dumps were skipped in favor of a full `./backup` taken immediately
before the two rollout transactions.

## Context — the bug this fixed

Artist pages could show fake "N editions" stacks built from unrelated budget compilations, via two
guessing mechanisms:

- **index** titled a folder-release with the *mode* of its tracks' `album`/`year` tags, so a folder
  whose tracks named several different albums got titled after whichever string appeared most.
- **sync** bound on a plurality/">50%" of embedded MB ids, *rescued* a scattered folder when the
  candidate's tracklist happened to score COMPLETE, and "upgraded" to a deluxe sibling — so those
  folders bound to real MB releases inside one release group, which the artist page then stacked by
  release-group id.

## Measured production impact (read-only, excluding box-placed/folded/forcedComplete)

Roughly 16,800 releases moved to UNKNOWN: the large majority from album-tag disagreement, a handful
from a missing album tag, and a few thousand from an MB-id disagreement despite a unanimous album tag.
Of those, most were already bound, and a meaningful fraction had previously scored `COMPLETE` purely
because sync's old plurality rule had rescued a scattered folder. That reclassification back to
`UNKNOWN` is the intended consequence of the rule, not a regression.

## Decisions settled at rollout time (user-confirmed, previously open)

1. Release-id divergence is terminal even when the release group is unanimous — not a rescue path.
   Gets its own reason string so the cause stays legible in the UI.
2. `status.rs`'s edition tie-break (same year → CD format → earliest date, among editions whose track
   count matches exactly) stays, explicitly out of scope for this change.
3. No extra scope: index ownership majority, `problems`/`audit` tag-fix majorities, and the shared-id
   "internally consistent but wrong" shape (see `docs/sync_decisions.md` §15 item 8) were left open,
   documented rather than silently out of scope.
4. Full rollout: implement → test → commit → deploy → undo-safety step → one-off migration →
   library-wide re-score.

## Corrections found during rollout

- The app container has no `psql` binary — every `docker exec <app> psql ...` command drafted ahead of
  time was wrong on this NAS; the Postgres container itself has to run `psql`, and the app's own
  wrapper scripts need `sudo` since the operating account isn't in the `docker` group (see
  `reference_nas_docker_sudo.md`).
- Undo dumps (the narrower, non-downtime undo path) were skipped in the actual rollout in favor of a
  full `./backup` taken immediately before both rollout transactions — judged sufficient since no other
  writes were expected in that window, and a full-DB point-in-time restore was an acceptable tradeoff
  against a scoped undo for a one-time run. The narrower dump approach is still worth keeping as a
  documented option for a future rollout that wants a non-downtime undo path.

## Rollout steps (all done)

1. Implement, build, full test suite (Rust workspace + web unit/lint/typecheck) — all green.
2. Commit + push directly to `master`, no attribution trailer.
3. Deploy (migration + binaries) — ran clean.
4. Backup → one-off migration (flag rows, then sweep newly-orphaned MB releases) → library-wide
   `tidy --rescore-only --all`. Preview vs. post-run counts matched exactly; the re-score pass touched
   several thousand unrelated already-bound releases with zero status changes among them.
5. Recorded the real counts in `docs/specs/spec_tidy_observations.md` §19 "Round 8".

Not done by this rollout (deliberately, not an oversight): the user's own visual check of affected
artist pages, per the standing "no self-login" rule.

## Verification log

- Artist pages that used to show bogus multi-edition stacks from scattered compilations now show
  UNKNOWN with a reason, folder-leaf titles, cleared `releaseId` — confirmed by the user's own visual
  check.
- A separate, still-unresolved case (several differently-tagged copies of one release all
  *unanimously* sharing one wrong id) is expected to survive this change untouched — out of scope, see
  `docs/sync_decisions.md` §15 item 8. Not a regression if seen.
- Post-one-off counts matched the preview exactly. See `docs/specs/spec_tidy_observations.md` §19.
- Running sync twice against a newly-UNKNOWN-with-reason release: the artist is not re-queued, the
  second run is a no-op — covered by an explicit `AND "statusReason" IS NULL` guard on the
  pending-sync query.
- Retagging a folder back into agreement returns it to `UNMATCHED`, then a normal sync re-binds it —
  covered by an integration test, not yet re-exercised against the live library post-rollout at time
  of writing.
