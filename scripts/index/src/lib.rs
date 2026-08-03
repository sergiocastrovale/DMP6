//! Library target for the `index` binary. Exists so integration tests under `tests/` can call the
//! deletion/db helpers directly against a scratch database - a binary-only crate can't be imported.
//! `main.rs` consumes the same modules through this lib, so there is exactly one copy of each.

pub mod db;
pub mod deletion;
