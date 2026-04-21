use aws_sdk_s3::Client as S3Client;
use common::config::Config;
use common::s3::upload_to_s3;
use image::imageops::FilterType;
use reqwest::Client;
use std::path::{Path, PathBuf};

use crate::mb_types::MbArtistDetail;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async fn download_and_resize(
    client: &Client,
    url: &str,
    dest: &Path,
    max_px: u32,
) -> Result<(), String> {
    let bytes = client
        .get(url)
        .header("User-Agent", crate::mb_api::USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?
        .bytes()
        .await
        .map_err(|e| format!("Read body failed: {}", e))?;

    let img = image::load_from_memory(&bytes).map_err(|e| format!("Image decode: {}", e))?;

    let (w, h) = (img.width(), img.height());
    let img = if w > max_px || h > max_px {
        img.resize(max_px, max_px, FilterType::Lanczos3)
    } else {
        img
    };

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    img.save(dest).map_err(|e| format!("Save failed: {}", e))?;
    Ok(())
}

async fn upload_image(
    s3_client: &Option<S3Client>,
    local_path: &Path,
    config: &Config,
    s3_key: &str,
) -> Result<(), String> {
    if let Some(ref client) = s3_client {
        if let Some(ref bucket) = config.s3_bucket {
            upload_to_s3(client, bucket, s3_key, local_path)
                .await
                .map_err(|e| format!("S3 upload failed: {}", e))?;
            if !config.use_local() {
                let _ = std::fs::remove_file(local_path);
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Cover art (MusicBrainz Cover Art Archive)
// ---------------------------------------------------------------------------

pub async fn download_cover_art(
    client: &Client,
    mb_release_id: &str,
    project_root: &str,
    s3_client: &Option<S3Client>,
    config: &Config,
) -> Result<bool, String> {
    let s3_key = format!("releases/{}.jpg", mb_release_id);
    let local_path = PathBuf::from(project_root)
        .join("web/public/img/releases")
        .join(format!("{}.jpg", mb_release_id));

    if config.use_local() && local_path.exists() {
        return Ok(false);
    }

    let url = format!(
        "https://coverartarchive.org/release-group/{}/front-500",
        mb_release_id
    );

    let resp = client
        .get(&url)
        .header("User-Agent", crate::mb_api::USER_AGENT)
        .send()
        .await
        .map_err(|e| format!("CAA request failed: {}", e))?;

    if !resp.status().is_success() {
        return Ok(false);
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("CAA read body: {}", e))?;

    let img = match image::load_from_memory(&bytes) {
        Ok(i) => i,
        Err(_) => return Ok(false),
    };

    if config.use_local() || s3_client.is_some() {
        if let Some(parent) = local_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        let img = img.resize(500, 500, FilterType::Lanczos3);
        img.save(&local_path)
            .map_err(|e| format!("Save cover: {}", e))?;
        upload_image(s3_client, &local_path, config, &s3_key).await?;
    }

    Ok(true)
}

// ---------------------------------------------------------------------------
// Artist image (Wikidata → Wikipedia → Fanart.tv)
// ---------------------------------------------------------------------------

async fn get_wikidata_image(client: &Client, wikidata_url: &str) -> Option<String> {
    let entity_id = wikidata_url
        .split('/')
        .last()
        .filter(|s| s.starts_with('Q'))?;
    let api_url = format!(
        "https://www.wikidata.org/w/api.php?action=wbgetentities&ids={}&props=claims&format=json",
        entity_id
    );
    let body = client
        .get(&api_url)
        .header("User-Agent", crate::mb_api::USER_AGENT)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let p18 = v["entities"][entity_id]["claims"]["P18"]
        .as_array()?
        .first()?;
    let filename = p18["mainsnak"]["datavalue"]["value"].as_str()?;
    Some(format!(
        "https://commons.wikimedia.org/wiki/Special:FilePath/{}",
        urlencoding::encode(filename)
    ))
}

async fn get_wikipedia_image(client: &Client, wikipedia_url: &str) -> Option<String> {
    let title = wikipedia_url
        .split("/wiki/")
        .nth(1)
        .map(|s| s.replace(' ', "_"))?;

    let lang = wikipedia_url
        .split("://")
        .nth(1)
        .and_then(|s| s.split('.').next())
        .unwrap_or("en");

    let api_url = format!(
        "https://{}.wikipedia.org/w/api.php?action=query&titles={}&prop=pageimages&format=json&pithumbsize=500",
        lang,
        urlencoding::encode(&title)
    );
    let body = client
        .get(&api_url)
        .header("User-Agent", crate::mb_api::USER_AGENT)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let pages = v["query"]["pages"].as_object()?;
    let page = pages.values().next()?;
    page["thumbnail"]["source"].as_str().map(|s| s.to_string())
}

async fn get_fanart_image(client: &Client, mb_artist_id: &str, api_key: &str) -> Option<String> {
    let url = format!(
        "https://webservice.fanart.tv/v3/music/{}?api_key={}",
        mb_artist_id, api_key
    );
    let body = client
        .get(&url)
        .header("User-Agent", crate::mb_api::USER_AGENT)
        .send()
        .await
        .ok()?
        .text()
        .await
        .ok()?;

    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    let thumbs = v["artistthumb"].as_array()?;
    thumbs
        .first()
        .and_then(|t| t["url"].as_str())
        .map(|s| s.to_string())
}

pub async fn download_artist_image(
    client: &Client,
    detail: &MbArtistDetail,
    artist_slug: &str,
    project_root: &str,
    s3_client: &Option<S3Client>,
    config: &Config,
) -> Result<bool, String> {
    let s3_key = format!("artists/{}.jpg", artist_slug);
    let local_path = PathBuf::from(project_root)
        .join("web/public/img/artists")
        .join(format!("{}.jpg", artist_slug));

    if config.use_local() && local_path.exists() {
        return Ok(false);
    }

    let mut image_url: Option<String> = None;

    if let Some(ref relations) = detail.relations {
        for rel in relations {
            if image_url.is_some() {
                break;
            }
            if let Some(ref url_obj) = rel.url {
                let resource = &url_obj.resource;
                match rel.relation_type.as_str() {
                    "wikidata" => {
                        image_url = get_wikidata_image(client, resource).await;
                    }
                    "wikipedia" => {
                        if image_url.is_none() {
                            image_url = get_wikipedia_image(client, resource).await;
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    if image_url.is_none() {
        if let Some(ref api_key) = config.fanart_api_key {
            image_url = get_fanart_image(client, &detail.id, api_key).await;
        }
    }

    let url = match image_url {
        Some(u) => u,
        None => return Ok(false),
    };

    match download_and_resize(client, &url, &local_path, 500).await {
        Ok(()) => {
            upload_image(s3_client, &local_path, config, &s3_key).await?;
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

