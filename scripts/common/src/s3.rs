use aws_config::BehaviorVersion;
use aws_sdk_s3::primitives::ByteStream;
use aws_sdk_s3::Client as S3Client;
use crate::config::Config;
use std::path::Path;

pub async fn create_s3_client(config: &Config) -> Option<S3Client> {
    if config.s3_bucket.is_none() || config.s3_region.is_none() {
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

    if let Some(ref endpoint) = config.s3_endpoint {
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

pub async fn delete_from_s3(client: &S3Client, bucket: &str, key: &str) {
    client.delete_object().bucket(bucket).key(key).send().await.ok();
}
