//! MusicBrainz client, shared by `sync` (release/artist enrichment) and `index` (artist resolution).
//!
//! Lives in `common` rather than `sync` because both binaries need one rate limiter implementation -
//! MB's 1 req/s budget is per-application, not per-process.

pub mod allowlist;
pub mod api;
pub mod names;
pub mod resolve;
pub mod types;
