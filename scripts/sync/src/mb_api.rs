//! The MusicBrainz HTTP client now lives in `common::mb::api` so `index` can share it - MB's rate
//! budget is per-application, so there must be exactly one `RateLimiter` implementation. This module
//! stays as a re-export so sync's existing `crate::mb_api::*` imports keep working unchanged.

pub use common::mb::api::*;
