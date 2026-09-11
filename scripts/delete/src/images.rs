//! S3 helpers shared by the artist-delete and release-delete paths. Split out of `main.rs` so
//! `release.rs` doesn't need to reach into the binary crate for them.

use aws_sdk_s3::Client as S3Client;

pub async fn delete_from_s3(client: &S3Client, bucket: &str, key: &str) {
    client
        .delete_object()
        .bucket(bucket)
        .key(key)
        .send()
        .await
        .ok();
}

pub fn extract_s3_key(url: &str) -> Option<String> {
    if let Some(pos) = url.find(".com/") {
        return Some(url[pos + 5..].to_string());
    }
    let mut slashes = 0;
    for (i, c) in url.char_indices() {
        if c == '/' {
            slashes += 1;
            if slashes == 3 {
                return Some(url[i + 1..].to_string());
            }
        }
    }
    None
}
