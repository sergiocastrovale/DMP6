mod corrupted;
mod duplicates;
mod missing;
mod orphans;
mod revert;
mod tags;
mod unsplit;

use clap::Parser;
use colored::Colorize;
use common::{config::{apply_db_overrides, load_config}, db::create_pool};

#[derive(Parser, Debug)]
#[command(name = "fix", about = "Apply fixes for PENDING metadata issues")]
struct Args {
    /// Fix corrupted TPE2 issues
    #[arg(long)]
    corrupted: bool,
    /// Fix unsplit compound artist issues
    #[arg(long)]
    unsplit: bool,
    /// Fix orphan artist issues (delete them)
    #[arg(long)]
    orphans: bool,
    /// Fix duplicate artist issues (merge B into A)
    #[arg(long)]
    duplicates: bool,
    /// Fix missing metadata issues
    #[arg(long)]
    missing: bool,
    /// Revert previously applied fixes instead of applying new ones
    #[arg(long)]
    revert: bool,
    /// Revert mode: 'undo' (back to DETECTED) or 'undo-resolved' (stays RESOLVED)
    #[arg(long, default_value = "undo")]
    mode: String,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let mut config = load_config(None);
    let pool = create_pool(&config.database_url).await;
    apply_db_overrides(&mut config, &pool).await;

    if !args.corrupted && !args.unsplit && !args.orphans && !args.duplicates && !args.missing {
        eprintln!("{}", "Specify at least one fix type: --corrupted, --unsplit, --orphans, --duplicates, --missing".red());
        std::process::exit(1);
    }

    let music_dir = config.music_dir.as_deref().unwrap_or("").to_string();

    if args.revert {
        if args.corrupted {
            println!("{}", "↩ Reverting corrupted TPE2 fixes...".cyan().bold());
            match revert::revert(&pool, &music_dir, "corrupted", &args.mode).await {
                Ok((ok, fail)) => println!("  {} reverted, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => eprintln!("  {}: {}", "ERROR".red(), e),
            }
        }
        if args.unsplit {
            println!("{}", "↩ Reverting unsplit artist fixes...".cyan().bold());
            match revert::revert(&pool, &music_dir, "unsplit", &args.mode).await {
                Ok((ok, fail)) => println!("  {} reverted, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => eprintln!("  {}: {}", "ERROR".red(), e),
            }
        }
        if args.missing {
            println!("{}", "↩ Reverting missing metadata fixes...".cyan().bold());
            match revert::revert(&pool, &music_dir, "missing", &args.mode).await {
                Ok((ok, fail)) => println!("  {} reverted, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => eprintln!("  {}: {}", "ERROR".red(), e),
            }
        }
        if args.orphans || args.duplicates {
            eprintln!("{}", "Revert not supported for orphans or duplicates.".yellow());
        }
    } else {
        if args.corrupted {
            println!("{}", "→ Fixing corrupted TPE2 issues...".cyan().bold());
            match corrupted::fix(&pool, &music_dir).await {
                Ok((ok, fail)) => println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => eprintln!("  {}: {}", "ERROR".red(), e),
            }
        }

        if args.unsplit {
            println!("{}", "→ Fixing unsplit artist issues...".cyan().bold());
            match unsplit::fix(&pool, &music_dir).await {
                Ok((ok, fail)) => println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => eprintln!("  {}: {}", "ERROR".red(), e),
            }
        }

        if args.orphans {
            println!("{}", "→ Fixing orphan artist issues...".cyan().bold());
            match orphans::fix(&pool, &config).await {
                Ok((ok, fail)) => println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => eprintln!("  {}: {}", "ERROR".red(), e),
            }
        }

        if args.duplicates {
            println!("{}", "→ Fixing duplicate artist issues...".cyan().bold());
            match duplicates::fix(&pool, &config, &music_dir).await {
                Ok((ok, fail)) => println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => eprintln!("  {}: {}", "ERROR".red(), e),
            }
        }

        if args.missing {
            println!("{}", "→ Fixing missing metadata issues...".cyan().bold());
            match missing::fix(&pool, &music_dir).await {
                Ok((ok, fail)) => println!("  {} resolved, {} failed", ok.to_string().green(), fail.to_string().red()),
                Err(e) => eprintln!("  {}: {}", "ERROR".red(), e),
            }
        }
    }

    if let Err(e) = common::statistics::update_statistics(&pool).await {
        eprintln!("Warning: failed to update statistics: {}", e);
    }

    println!("{}", "Done.".green().bold());
}
