pub mod box_editions;
pub mod boxset;
pub mod catalogue_gaps;
pub mod db;
pub mod images;
// The MusicBrainz client + types live in `common::mb::{api,types}` so `index` can share them (MB's
// rate budget is per-application, so there must be exactly one `RateLimiter`). Re-exported under
// their old module names so the existing `crate::mb_api::*`/`mb_types::*` call sites throughout this
// crate need no changes.
pub use common::mb::api as mb_api;
pub use common::mb::types as mb_types;
pub mod mb_matching;
pub mod owned;
pub mod status;
pub mod title_rules;
