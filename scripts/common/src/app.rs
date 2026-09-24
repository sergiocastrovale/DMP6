use sqlx::PgPool;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Spawns the Ctrl-C + SIGTERM handler pair every scan-locking binary needs: on either signal, stop
/// the run (`running` flips to `false`), release the scan lock, and exit. A second Ctrl-C force-exits
/// immediately without waiting for the current unit to finish.
///
/// `unit` names what "finishing current ..." refers to in the shutdown message (e.g. "folder",
/// "artist", "phase"). `sigterm_exit_code` is what the SIGTERM path exits with - binaries differ here
/// (0 vs 1); Ctrl-C always exits 1.
pub fn spawn_shutdown_handlers(
    pool: &PgPool,
    binary: &'static str,
    unit: &'static str,
    sigterm_exit_code: i32,
) -> Arc<AtomicBool> {
    let running = Arc::new(AtomicBool::new(true));
    {
        let running = running.clone();
        let pool = pool.clone();
        tokio::spawn(async move {
            tokio::signal::ctrl_c().await.ok();
            running.store(false, Ordering::SeqCst);
            eprintln!("\nShutdown requested - finishing current {unit}...");
            tokio::signal::ctrl_c().await.ok();
            crate::lock::release_lock(&pool, binary, std::process::id()).await;
            std::process::exit(1);
        });
    }
    {
        let running = running.clone();
        let pool = pool.clone();
        tokio::spawn(async move {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("SIGTERM handler");
            term.recv().await;
            running.store(false, Ordering::SeqCst);
            crate::lock::release_lock(&pool, binary, std::process::id()).await;
            std::process::exit(sigterm_exit_code);
        });
    }
    running
}
