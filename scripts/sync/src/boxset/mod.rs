//! Box-set binding: matches sibling disc folders index left unmerged (index never folds,
//! docs/sync_decisions.md) to a box's *media* by tracklist, since MusicBrainz box sets don't carry the
//! id discipline plain multi-disc detection relies on. Two shapes handled identically:
//!
//!   (a) one disc mis-tagged as the standalone album (embedded ids disjoint, not unanimous)
//!   (b) every disc tagged as its own standalone album (embedded ids differ entirely, and often
//!       every sibling reads discNumber=1 since no file was ever told it was part of a box)
//!
//! MusicBrainz has no box-set entity: a box is one Release with N media, and MB stores no link from
//! a box's disc to the standalone release it duplicates - the only shared identity is the recording
//! (docs/sync_decisions.md). This module matches siblings to *media* by tracklist, never by any id the
//! files carry, and accepts only a **perfect matching**: every sibling maps to exactly one medium,
//! with equal track count and every track's title+duration (±5s) agreeing - the same rule
//! `owned::find_owning_bundle` uses for the bonus-disc case. Any ambiguity rejects the whole group; a
//! box with some discs not owned at all is fine (a partial match), a box where a disc could equally
//! be two different media is not.
//!
//! Binding a box is only half the job: `run_repair` also decides, once equivalences are known, fold
//! (genuine multi-disc release) or dissolve (box set) - docs/sync_decisions.md.
//!
//! Split by the section banners this file already had - `pairing` (pure decision logic, no
//! network/DB), `candidates` (network + DB discovery), `discovery` (DB-only sibling-group discovery),
//! `apply` (persist a successful plan + fold-vs-dissolve), `orchestration` (`run_repair`, the entry
//! point). `pub use` re-exports below keep every existing `boxset::Whatever` path unchanged.

mod apply;
mod candidates;
mod discovery;
mod orchestration;
mod pairing;
#[cfg(test)]
mod tests;

pub(crate) use apply::*;
pub(crate) use candidates::*;
pub(crate) use discovery::*;
pub use orchestration::*;
pub use pairing::*;
