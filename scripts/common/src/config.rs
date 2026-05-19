use sqlx::PgPool;
use std::path::PathBuf;

pub struct Config {
    pub music_dir: Option<String>,
    /// true when music_dir came from a CLI arg — DB override must not replace it.
    pub music_dir_locked: bool,
    pub database_url: String,
    pub project_root: String,
    pub image_dir: String,
    pub image_storage: String,
    pub s3_bucket: Option<String>,
    pub s3_region: Option<String>,
    pub s3_access_key: Option<String>,
    pub s3_secret_key: Option<String>,
    pub s3_endpoint: Option<String>,
    pub s3_public_url: Option<String>,
    pub fanart_api_key: Option<String>,
}

impl Config {
    /// Returns music_dir or panics — used by index which requires it.
    pub fn require_music_dir(&self) -> &str {
        self.music_dir.as_deref().expect("MUSIC_DIR not set. Pass as argument or set in web/.env")
    }

    pub fn use_s3(&self) -> bool {
        self.image_storage == "s3" || self.image_storage == "both"
    }

    pub fn use_local(&self) -> bool {
        self.image_storage == "local" || self.image_storage == "both"
    }
}

pub fn load_config(music_dir_override: Option<&str>) -> Config {
    let env_paths = [PathBuf::from("web/.env"), PathBuf::from("../../web/.env")];
    let mut env_loaded = false;
    for p in &env_paths {
        if p.exists() {
            dotenvy::from_path(p).ok();
            env_loaded = true;
            break;
        }
    }
    if !env_loaded {
        if let Ok(project_root) = std::env::var("PROJECT_ROOT") {
            let env_path = PathBuf::from(&project_root).join("web/.env");
            if env_path.exists() {
                dotenvy::from_path(env_path).ok();
            }
        }
    }

    let music_dir = music_dir_override
        .map(|s| s.to_string())
        .or_else(|| std::env::var("MUSIC_DIR").ok());

    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL not set in web/.env");

    let project_root = std::env::var("PROJECT_ROOT").unwrap_or_else(|_| {
        std::env::current_dir()
            .ok()
            .and_then(|d| {
                // Walk up from scripts/index or scripts/sync to project root
                if d.ends_with("scripts/index") || d.ends_with("scripts/sync") || d.ends_with("scripts/sync") {
                    d.parent().and_then(|p| p.parent()).map(|p| p.to_string_lossy().to_string())
                } else if d.ends_with("scripts") {
                    d.parent().map(|p| p.to_string_lossy().to_string())
                } else {
                    Some(d.to_string_lossy().to_string())
                }
            })
            .unwrap_or_else(|| ".".to_string())
    });

    let image_dir = std::env::var("IMAGE_DIR").unwrap_or_else(|_| {
        PathBuf::from(&project_root)
            .join("web/public/img")
            .to_string_lossy()
            .to_string()
    });

    Config {
        music_dir,
        music_dir_locked: music_dir_override.is_some(),
        database_url,
        project_root,
        image_dir,
        image_storage: std::env::var("IMAGE_STORAGE").unwrap_or_else(|_| "local".to_string()),
        s3_bucket: std::env::var("S3_IMAGE_BUCKET").ok(),
        s3_region: std::env::var("AWS_REGION").ok(),
        s3_access_key: std::env::var("AWS_ACCESS_KEY_ID").ok(),
        s3_secret_key: std::env::var("AWS_SECRET_ACCESS_KEY").ok(),
        s3_endpoint: std::env::var("S3_ENDPOINT").ok().filter(|s| !s.is_empty()),
        s3_public_url: std::env::var("S3_PUBLIC_URL").ok(),
        fanart_api_key: std::env::var("FANART_API_KEY").ok().filter(|s| !s.is_empty()),
    }
}

/// Override env-loaded config fields with values from the DB Settings row.
/// Call this after creating the pool. Errors are soft — logs a warning and continues.
pub async fn apply_db_overrides(config: &mut Config, pool: &PgPool) {
    let row: Option<(
        Option<String>, // musicDir
        Option<String>, // imageStorage
        Option<String>, // s3ImageBucket
        Option<String>, // awsRegion
        Option<String>, // awsAccessKeyId
        Option<String>, // awsSecretAccessKey
        Option<String>, // s3Endpoint
        Option<String>, // s3PublicUrl
        Option<String>, // fanartApiKey
    )> = sqlx::query_as(
        r#"SELECT "musicDir", "imageStorage", "s3ImageBucket", "awsRegion",
                  "awsAccessKeyId", "awsSecretAccessKey", "s3Endpoint", "s3PublicUrl",
                  "fanartApiKey"
           FROM "Settings" WHERE id = 'main'"#,
    )
    .fetch_optional(pool)
    .await
    .unwrap_or_else(|e| {
        crate::error_log::log_warn(&format!("could not load DB settings overrides: {e}"));
        eprintln!("Warning: could not load DB settings overrides: {e}");
        None
    });

    if let Some((music_dir, image_storage, s3_bucket, s3_region, s3_access_key, s3_secret_key, s3_endpoint, s3_public_url, fanart_api_key)) = row {
        if !config.music_dir_locked {
            if let Some(v) = music_dir { config.music_dir = Some(v); }
        }
        if let Some(v) = image_storage { config.image_storage = v; }
        if let Some(v) = s3_bucket { config.s3_bucket = Some(v); }
        if let Some(v) = s3_region { config.s3_region = Some(v); }
        if let Some(v) = s3_access_key { config.s3_access_key = Some(v); }
        if let Some(v) = s3_secret_key { config.s3_secret_key = Some(v); }
        if let Some(v) = s3_endpoint { config.s3_endpoint = Some(v); }
        if let Some(v) = s3_public_url { config.s3_public_url = Some(v); }
        if let Some(v) = fanart_api_key { config.fanart_api_key = Some(v); }
    }
}
