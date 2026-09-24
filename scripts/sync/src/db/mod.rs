//! DB access, split by the entity each function touches. Was one 2350-line file; module boundaries
//! follow the section banners that file already had. `pub use` re-exports keep every existing
//! `crate::db::Whatever` / `dmp_sync::db::Whatever` path working unchanged.

mod artist;
mod cleanup;
mod identity;
mod local;
mod mb_release;
mod rescore;
mod watermark;

pub use artist::*;
pub use cleanup::*;
pub use identity::*;
pub use local::*;
pub use mb_release::*;
pub use rescore::*;
pub use watermark::*;
