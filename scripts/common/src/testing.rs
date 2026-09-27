//! Test support shared by the crates' integration tests (enabled with the `testing` feature, dev-dependencies only):
//! a MusicBrainz stand-in serving fixed artists and release groups, so tests that exercise MusicBrainz-backed decisions
//! run offline and deterministically.

use std::collections::HashMap;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// A MusicBrainz stand-in: artist details, exact-name search, and release-group browses, from fixed data.
#[derive(Clone, Default)]
pub struct MbStub {
    /// id -> (name, country)
    pub artists: HashMap<String, (String, Option<String>)>,
    /// id -> release-group titles
    pub groups: HashMap<String, Vec<String>>,
}

/// One stub for a whole test binary, on its own thread and runtime so it outlives any one test's runtime. Tests
/// register their (uniquely named) fixtures with [`shared_add_artist`] and point `MB_BASE_URL` at [`shared_url`] -
/// the MusicBrainz base URL is read once per process, so every test must use the same server.
static SHARED: std::sync::LazyLock<(std::sync::Arc<std::sync::Mutex<MbStub>>, String)> =
    std::sync::LazyLock::new(|| {
        let data = std::sync::Arc::new(std::sync::Mutex::new(MbStub::default()));
        let (tx, rx) = std::sync::mpsc::channel();
        let served = data.clone();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async move {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            tx.send(format!("http://{}/ws/2", listener.local_addr().unwrap())).unwrap();
            loop {
                let Ok((mut socket, _)) = listener.accept().await else { return };
                let served = served.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = socket.read(&mut buf).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let target = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let body = served.lock().unwrap().respond(&target);
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    socket.write_all(response.as_bytes()).await.ok();
                });
            }
        });
        });
        (data, rx.recv().unwrap())
    });

/// The shared stub's base URL, for `MB_BASE_URL`.
pub fn shared_url() -> String {
    SHARED.1.clone()
}

/// Register an artist (and its release groups) with the shared stub.
pub fn shared_add_artist(id: &str, name: &str, country: Option<&str>, groups: &[&str]) {
    let mut data = SHARED.0.lock().unwrap();
    data.artists
        .insert(id.to_string(), (name.to_string(), country.map(Into::into)));
    data.groups.insert(
        id.to_string(),
        groups.iter().map(|g| g.to_string()).collect(),
    );
}

impl MbStub {
    fn respond(&self, target: &str) -> String {
        let path = target.split('?').next().unwrap_or("");
        let query = target.split_once('?').map(|(_, q)| q).unwrap_or("");
        if path.ends_with("/artist/") {
            let artists: Vec<serde_json::Value> = self
                .artists
                .iter()
                .map(|(id, (name, _))| serde_json::json!({ "id": id, "name": name, "score": 100 }))
                .collect();
            return serde_json::json!({ "artists": artists, "count": artists.len() }).to_string();
        }
        if let Some(id) = path.strip_prefix("/ws/2/artist/") {
            if let Some((name, country)) = self.artists.get(id) {
                let area = country
                    .as_ref()
                    .map(|c| serde_json::json!({ "iso-3166-1-codes": [c] }));
                return serde_json::json!({ "id": id, "name": name, "area": area, "relations": [], "genres": [], "tags": [] }).to_string();
            }
        }
        if path.ends_with("/release-group") {
            let artist = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("artist="))
                .unwrap_or("");
            let offset: usize = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("offset="))
                .and_then(|o| o.parse().ok())
                .unwrap_or(0);
            let all = self.groups.get(artist).cloned().unwrap_or_default();
            let page: Vec<serde_json::Value> = all
                .iter()
                .skip(offset)
                .enumerate()
                .map(|(i, t)| serde_json::json!({ "id": format!("rg-{artist}-{i}"), "title": t, "primary-type": "Album", "first-release-date": "2020" }))
                .collect();
            return serde_json::json!({ "release-groups": page, "release-group-count": all.len() })
                .to_string();
        }
        serde_json::json!({ "releases": [], "release-count": 0, "release-groups": [], "release-group-count": 0, "artists": [] }).to_string()
    }

    /// Starts serving on a free local port; returns the base URL to put in `MB_BASE_URL`.
    pub async fn serve(self) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mb = std::sync::Arc::new(self);
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                let mb = mb.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 8192];
                    let n = socket.read(&mut buf).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buf[..n]);
                    let target = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let body = mb.respond(&target);
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    socket.write_all(response.as_bytes()).await.ok();
                });
            }
        });
        format!("http://{addr}/ws/2")
    }
}
