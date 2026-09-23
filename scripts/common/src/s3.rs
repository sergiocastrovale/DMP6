use crate::config::Config;
use aws_config::BehaviorVersion;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client as S3Client;
use std::path::Path;

pub async fn create_s3_client(config: &Config) -> Option<S3Client> {
    if config.storage_bucket.is_none() || config.s3_region.is_none() {
        return None;
    }

    let mut aws_cfg = aws_config::defaults(BehaviorVersion::latest());

    if let Some(ref region) = config.s3_region {
        aws_cfg = aws_cfg.region(aws_sdk_s3::config::Region::new(region.clone()));
    }

    if let (Some(ref key), Some(ref secret)) = (&config.s3_access_key, &config.s3_secret_key) {
        aws_cfg = aws_cfg.credentials_provider(aws_sdk_s3::config::Credentials::new(
            key, secret, None, None, "dmp",
        ));
    }

    let aws_cfg = aws_cfg.load().await;
    let mut s3_config = aws_sdk_s3::config::Builder::from(&aws_cfg);

    if let Some(ref endpoint) = config.storage_endpoint {
        s3_config = s3_config.endpoint_url(endpoint);
    }

    Some(S3Client::from_conf(s3_config.build()))
}

pub async fn upload_to_s3(
    client: &S3Client,
    bucket: &str,
    key: &str,
    file_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let body = ByteStream::from_path(file_path).await?;
    client
        .put_object()
        .bucket(bucket)
        .key(key)
        .body(body)
        .content_type("image/jpeg")
        .send()
        .await?;
    Ok(())
}

pub async fn delete_from_s3(client: &S3Client, bucket: &str, key: &str) -> Result<(), String> {
    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .map(|_| ())
        .map_err(|e| format!("S3 delete {key}: {e}"))
}

/// The object key a stored image URL points at, when it lives under `STORAGE_PUBLIC_URL`.
pub fn key_from_public_url(config: &Config, url: &str) -> Option<String> {
    let base = config.storage_public_url.as_deref()?.trim_end_matches('/');
    url.strip_prefix(base)
        .map(|rest| rest.trim_start_matches('/').to_string())
        .filter(|k| !k.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(public_url: Option<&str>) -> Config {
        Config {
            music_dir: None,
            music_dir_locked: false,
            database_url: String::new(),
            project_root: String::new(),
            image_dir: String::new(),
            image_storage: "s3".into(),
            storage_bucket: Some("bucket".into()),
            s3_region: None,
            s3_access_key: None,
            s3_secret_key: None,
            storage_endpoint: None,
            storage_public_url: public_url.map(str::to_string),
            fanart_api_key: None,
        }
    }

    #[test]
    fn key_from_public_url_strips_the_configured_prefix() {
        let c = config(Some("https://cdn.example.com/bucket/"));
        assert_eq!(
            key_from_public_url(&c, "https://cdn.example.com/bucket/releases/abc.jpg").as_deref(),
            Some("releases/abc.jpg")
        );
        assert_eq!(
            key_from_public_url(&c, "https://elsewhere/releases/abc.jpg"),
            None
        );
        assert_eq!(
            key_from_public_url(&config(None), "https://x/releases/a.jpg"),
            None
        );
    }
}
