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
        format!(
            "{}/release/{}/front-500",
            common::mb::api::cover_art_base(),
            release_id
        ),
        format!(
            "{}/release-group/{}/front-500",
            common::mb::api::cover_art_base(),
            release_group_id
        ),
    ];

    let mut bytes_result = None;
    for url in &urls {
        let resp = client
            .get(url)
            .header("User-Agent", common::mb::api::user_agent())
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
