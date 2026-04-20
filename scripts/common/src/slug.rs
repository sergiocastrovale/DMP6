use md5::{Digest, Md5};
use slug::slugify;

pub fn make_slug(name: &str) -> String {
    let s = slugify(name);
    if s.is_empty() {
        // Fallback for names with no alphanumeric chars (e.g. "!!!")
        let mut hasher = Md5::new();
        hasher.update(name.as_bytes());
        format!("artist-{:x}", hasher.finalize())
    } else {
        s
    }
}
