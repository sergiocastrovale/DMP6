use std::path::PathBuf;

pub struct Config {
    pub music_dir: Option<String>,
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
