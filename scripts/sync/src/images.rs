use reqwest::Client;

// ---------------------------------------------------------------------------
// Cover art (MusicBrainz Cover Art Archive)
// ---------------------------------------------------------------------------

pub async fn download_cover_art(
    client: &Client,
    release_id: &str,
    release_group_id: &str,
) -> Result<Option<Vec<u8>>, String> {
    let urls = [
        format!("https://coverartarchive.org/release/{}/front-500", release_id),
        format!("https://coverartarchive.org/release-group/{}/front-500", release_group_id),
    ];

    let mut bytes_result = None;
    for url in &urls {
        let resp = client
            .get(url)
            .header("User-Agent", crate::mb_api::USER_AGENT)
            .send()
            .await
            .map_err(|e| format!("CAA request failed: {}", e))?;

        if resp.status().is_success() {
            bytes_result = Some(
                resp.bytes()
                    .await
                    .map_err(|e| format!("CAA read body: {}", e))?,
            );
            break;
        }
    }

    let bytes = match bytes_result {
        Some(b) => b,
        None => return Ok(None),
    };

    if image::load_from_memory(&bytes).is_err() {
        return Ok(None);
    }

    Ok(Some(bytes.to_vec()))
}

