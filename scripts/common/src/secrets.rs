use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sha2::{Digest, Sha256};

// Reads the credentials the web app keeps encrypted at rest (web/server/utils/secretBox.ts - keep the two in step).
// A stored value is "enc:v1:" + base64(iv[12] | ciphertext | tag[16]) under AES-256-GCM, keyed by
// SHA-256(SETTINGS_ENCRYPTION_KEY). A value without the prefix is a legacy plaintext one and is returned as it is.

const PREFIX: &str = "enc:v1:";
const IV_BYTES: usize = 12;
const TAG_BYTES: usize = 16;

/// The plaintext of a stored settings value, or None when it is encrypted and cannot be opened (no key configured,
/// wrong key, damaged). Callers treat None as "not set" and fall back to their env value.
pub fn decrypt_secret(stored: &str) -> Option<String> {
    decrypt_with(stored, std::env::var("SETTINGS_ENCRYPTION_KEY").ok().as_deref())
}

fn decrypt_with(stored: &str, key: Option<&str>) -> Option<String> {
    let Some(encoded) = stored.strip_prefix(PREFIX) else {
        return Some(stored.to_string());
    };
    let key = key.filter(|k| !k.is_empty())?;
    let blob = STANDARD.decode(encoded).ok()?;
    if blob.len() < IV_BYTES + TAG_BYTES {
        return None;
    }
    let (iv, sealed) = blob.split_at(IV_BYTES);
    let aes_key = Sha256::digest(key.as_bytes());
    // aes-gcm takes the ciphertext with the tag appended, which is exactly the stored layout.
    let plain = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&aes_key))
        .decrypt(Nonce::from_slice(iv), sealed)
        .ok()?;
    String::from_utf8(plain).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: &str = "dmp-test-key-dmp-test-key-dmp-test-key";
    // Produced by web/server/utils/secretBox.ts with KEY; the web test decrypts the same string.
    const VECTOR: &str = "enc:v1:ADCnirZM3sEQA40cjbHswTeZXmmKn2gKq+NmmFkHnUBQSOblhhSi8n3kxRJl6Z8=";

    #[test]
    fn opens_a_value_the_web_app_encrypted() {
        assert_eq!(decrypt_with(VECTOR, Some(KEY)).as_deref(), Some("fanart-secret-value"));
    }

    #[test]
    fn a_legacy_plaintext_value_passes_through_with_or_without_a_key() {
        assert_eq!(decrypt_with("plain", None).as_deref(), Some("plain"));
        assert_eq!(decrypt_with("plain", Some(KEY)).as_deref(), Some("plain"));
    }

    #[test]
    fn an_encrypted_value_needs_the_right_key() {
        assert_eq!(decrypt_with(VECTOR, None), None);
        assert_eq!(decrypt_with(VECTOR, Some("")), None);
        assert_eq!(decrypt_with(VECTOR, Some("some-other-key-some-other-key-xxxx")), None);
    }

    #[test]
    fn damaged_or_truncated_values_are_none() {
        assert_eq!(decrypt_with("enc:v1:!!!not-base64", Some(KEY)), None);
        assert_eq!(decrypt_with("enc:v1:AAAA", Some(KEY)), None);
        let mut damaged = VECTOR.to_string();
        damaged.pop();
        damaged.pop();
        damaged.push_str("AA");
        assert_eq!(decrypt_with(&damaged, Some(KEY)), None);
    }
}
