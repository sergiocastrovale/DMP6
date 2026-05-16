mod corrupted;
mod unsplit;
mod orphans;
mod duplicates;
mod missing;
mod tags;

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

    if let Err(e) = common::statistics::update_statistics(&pool).await {
        eprintln!("Warning: failed to update statistics: {}", e);
    }

    println!("{}", "Done.".green().bold());
}
