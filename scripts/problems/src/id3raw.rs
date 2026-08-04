//! Minimal raw ID3v2 reader for date frames.
//!
//! # Why this exists
//!
//! On MP3, `lofty` 0.24 **destroys exactly the evidence this tool is looking for**:
//!
//! 1. `TimestampFrame::parse` returns `Ok(None)` for a payload it cannot parse, and the frame
//!    reader then skips the frame entirely - so a malformed `TDRC`/`TDRL`/`TDOR` is not merely
//!    unparsed, it is *absent* from the resulting tag.
//! 2. ID3v2.3's `TYER` is renamed to `TDRC` during header upgrade, before that parse - so a v2.3
//!    file with `TYER=97` goes down the same hole.
//! 3. Well-formed timestamps are re-serialized from the parsed struct, so even when a frame does
//!    survive, the string lofty hands back is canonicalized rather than what is on disk.
//!
//! Net effect: through every public lofty API, an MP3 tagged `TYER=97` or `TDRC=199?` is
//! indistinguishable from one with no date at all. Since "the year is silently lost" is one of the
//! defects we most need to report, the bytes have to be read directly.
//!
//! This reader understands text frames only, and only the date-ish ones. It is deliberately not a
//! general ID3 parser.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// Refuse to buffer a tag larger than this. Real date frames live in the first few KB; a larger
/// value means embedded artwork, which is not our business and would waste memory per worker.
const MAX_TAG_BYTES: u32 = 4 * 1024 * 1024;

/// Literal date-ish frame payloads, exactly as stored.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct RawId3Dates {
    /// v2.4 recording time, or a v2.3 TYER that the header upgrade would have renamed.
    pub tdrc: Option<String>,
    /// v2.3 TYER / v2.2 TYE, as it literally appears on disk.
    pub tyer: Option<String>,
    pub tdat: Option<String>,
    pub tdrl: Option<String>,
    pub tdor: Option<String>,
    pub tory: Option<String>,
}

impl RawId3Dates {
    pub fn is_empty(&self) -> bool {
        self.tdrc.is_none()
            && self.tyer.is_none()
            && self.tdat.is_none()
            && self.tdrl.is_none()
            && self.tdor.is_none()
            && self.tory.is_none()
    }
}

/// Decode a 4-byte synchsafe integer (7 bits per byte), used for ID3v2 tag size and v2.4 frame size.
fn synchsafe(b: &[u8]) -> u32 {
    ((b[0] as u32 & 0x7F) << 21)
        | ((b[1] as u32 & 0x7F) << 14)
        | ((b[2] as u32 & 0x7F) << 7)
        | (b[3] as u32 & 0x7F)
}

fn be_u32(b: &[u8]) -> u32 {
    ((b[0] as u32) << 24) | ((b[1] as u32) << 16) | ((b[2] as u32) << 8) | (b[3] as u32)
}

fn be_u24(b: &[u8]) -> u32 {
    ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32)
}

/// Decode a text-frame payload: first byte is the encoding, the rest is the string.
fn decode_text(payload: &[u8]) -> Option<String> {
    if payload.is_empty() {
        return None;
    }
    let (encoding, body) = (payload[0], &payload[1..]);
    let s = match encoding {
        // Latin-1. Each byte is its own codepoint.
        0 => body.iter().map(|&b| b as char).collect::<String>(),
        // UTF-16 with BOM.
        1 => decode_utf16_with_bom(body)?,
        // UTF-16BE, no BOM.
        2 => decode_utf16(body, true)?,
        // UTF-8.
        3 => String::from_utf8_lossy(body).into_owned(),
        _ => return None,
    };
    let trimmed = s.trim_end_matches('\0').trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn decode_utf16_with_bom(body: &[u8]) -> Option<String> {
    if body.len() < 2 {
        return None;
    }
    match (body[0], body[1]) {
        (0xFF, 0xFE) => decode_utf16(&body[2..], false),
        (0xFE, 0xFF) => decode_utf16(&body[2..], true),
        // No BOM despite the encoding byte claiming one; assume little-endian.
        _ => decode_utf16(body, false),
    }
}

fn decode_utf16(body: &[u8], big_endian: bool) -> Option<String> {
    let units: Vec<u16> = body
        .chunks_exact(2)
        .map(|c| {
            if big_endian {
                u16::from_be_bytes([c[0], c[1]])
            } else {
                u16::from_le_bytes([c[0], c[1]])
            }
        })
        .collect();
    Some(
        char::decode_utf16(units)
            .map(|r| r.unwrap_or('\u{FFFD}'))
            .collect(),
    )
}

/// Read the date-ish ID3v2 text frames straight off disk.
///
/// Returns `Ok(None)` when there is nothing useful to read: no ID3v2 header, an unsynchronised tag,
/// or a tag larger than [`MAX_TAG_BYTES`]. Unsynchronisation is deliberately unsupported - handling
/// it means reimplementing lofty's de-synchronisation stream, and it is essentially extinct in v2.4.
/// The Summary sheet states this limitation rather than letting it under-report silently.
pub fn read_id3v2_dates(path: &Path) -> std::io::Result<Option<RawId3Dates>> {
    let mut file = File::open(path)?;
    let mut header = [0u8; 10];
    if file.read_exact(&mut header).is_err() {
        return Ok(None);
    }
    if &header[0..3] != b"ID3" {
        return Ok(None);
    }

    let version = header[3];
    let flags = header[5];
    let size = synchsafe(&header[6..10]);
    if size == 0 || size > MAX_TAG_BYTES {
        return Ok(None);
    }
    // Unsynchronised tags need byte-unstuffing before frames can be walked.
    if flags & 0x80 != 0 {
        return Ok(None);
    }

    let mut buf = vec![0u8; size as usize];
    let read = file.read(&mut buf)?;
    buf.truncate(read);

    // Extended header: skip it.
    let mut pos = 0usize;
    if flags & 0x40 != 0 {
        if buf.len() < 4 {
            return Ok(None);
        }
        let ext_len = if version >= 4 {
            synchsafe(&buf[0..4])
        } else {
            be_u32(&buf[0..4]) + 4
        };
        pos = (ext_len as usize).min(buf.len());
    }

    let mut out = RawId3Dates::default();
    let (id_len, size_len) = if version == 2 {
        (3usize, 3usize)
    } else {
        (4usize, 4usize)
    };
    let flag_len = if version == 2 { 0usize } else { 2usize };
    let header_len = id_len + size_len + flag_len;

    while pos + header_len <= buf.len() {
        let id = &buf[pos..pos + id_len];
        // Padding: a run of zero bytes marks the end of the frame area.
        if id[0] == 0 {
            break;
        }
        let raw_size = &buf[pos + id_len..pos + id_len + size_len];
        let frame_size = match version {
            2 => be_u24(raw_size),
            // v2.4 sizes are synchsafe; v2.3 are plain big-endian. Getting this backwards silently
            // mis-walks the frame chain, which is why both are covered by tests.
            4 => synchsafe(raw_size),
            _ => be_u32(raw_size),
        } as usize;

        let body_start = pos + header_len;
        let body_end = body_start.saturating_add(frame_size);
        if frame_size == 0 || body_end > buf.len() {
            break;
        }

        let id_str = String::from_utf8_lossy(id).to_string();
        let slot = match id_str.as_str() {
            "TDRC" => Some(&mut out.tdrc),
            "TYER" | "TYE" => Some(&mut out.tyer),
            "TDAT" | "TDA" => Some(&mut out.tdat),
            "TDRL" => Some(&mut out.tdrl),
            "TDOR" => Some(&mut out.tdor),
            "TORY" | "TOR" => Some(&mut out.tory),
            _ => None,
        };
        if let Some(slot) = slot {
            if slot.is_none() {
                *slot = decode_text(&buf[body_start..body_end]);
            }
        }

        pos = body_end;
    }

    Ok((!out.is_empty()).then_some(out))
}

/// Seek back to the start; used by callers that reuse the handle. Kept separate so the reader above
/// stays a pure "open, read, done" operation.
#[allow(dead_code)]
pub fn rewind(file: &mut File) -> std::io::Result<()> {
    file.seek(SeekFrom::Start(0)).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Build an ID3v2 tag in memory. Fixtures are constructed in code rather than checked in as
    /// binaries so the byte layout under test is visible right here.
    fn build_tag(version: u8, frames: &[(&str, &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for (id, payload) in frames {
            body.extend_from_slice(id.as_bytes());
            let n = payload.len() as u32;
            if version == 4 {
                body.extend_from_slice(&[
                    ((n >> 21) & 0x7F) as u8,
                    ((n >> 14) & 0x7F) as u8,
                    ((n >> 7) & 0x7F) as u8,
                    (n & 0x7F) as u8,
                ]);
            } else {
                body.extend_from_slice(&n.to_be_bytes());
            }
            body.extend_from_slice(&[0, 0]);
            body.extend_from_slice(payload);
        }
        let size = body.len() as u32;
        let mut tag = Vec::new();
        tag.extend_from_slice(b"ID3");
        tag.push(version);
        tag.push(0);
        tag.push(0);
        tag.extend_from_slice(&[
            ((size >> 21) & 0x7F) as u8,
            ((size >> 14) & 0x7F) as u8,
            ((size >> 7) & 0x7F) as u8,
            (size & 0x7F) as u8,
        ]);
        tag.extend_from_slice(&body);
        tag
    }

    fn write_temp(bytes: &[u8]) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        // Unique per call: tests run concurrently, and two fixtures that happened to be the same
        // length would otherwise race on the same path.
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir();
        let name = format!(
            "problems-id3-test-{}-{}.mp3",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        );
        let path = dir.join(name);
        let mut f = File::create(&path).expect("create temp");
        f.write_all(bytes).expect("write temp");
        path
    }

    fn latin1(s: &str) -> Vec<u8> {
        let mut v = vec![0u8];
        v.extend(s.bytes());
        v
    }

    #[test]
    fn reads_a_v23_tyer_that_lofty_would_have_destroyed() {
        // The whole reason this module exists: TYER=97 is renamed to TDRC and then dropped as an
        // unparseable timestamp, so lofty reports the file as having no year at all.
        let tag = build_tag(3, &[("TYER", &latin1("97"))]);
        let path = write_temp(&tag);
        let got = read_id3v2_dates(&path).expect("read").expect("some dates");
        assert_eq!(got.tyer.as_deref(), Some("97"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn reads_a_v24_malformed_tdrc() {
        let tag = build_tag(4, &[("TDRC", &latin1("199?"))]);
        let path = write_temp(&tag);
        let got = read_id3v2_dates(&path).expect("read").expect("some dates");
        assert_eq!(got.tdrc.as_deref(), Some("199?"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn v24_synchsafe_and_v23_plain_frame_sizes_both_walk_correctly() {
        // A frame long enough that byte 2 exceeds 0x7F, so synchsafe and plain encodings differ.
        let long = "1".repeat(200);
        for version in [3u8, 4u8] {
            let tag = build_tag(
                version,
                &[("TDRC", &latin1(&long)), ("TDOR", &latin1("1975"))],
            );
            let path = write_temp(&tag);
            let got = read_id3v2_dates(&path).expect("read").expect("some dates");
            assert_eq!(
                got.tdor.as_deref(),
                Some("1975"),
                "v2.{version} second frame not reached - frame size decoding is wrong"
            );
            std::fs::remove_file(&path).ok();
        }
    }

    #[test]
    fn decodes_utf16_with_bom() {
        let mut payload = vec![1u8, 0xFF, 0xFE];
        for u in "1997".encode_utf16() {
            payload.extend_from_slice(&u.to_le_bytes());
        }
        let tag = build_tag(4, &[("TDRC", &payload)]);
        let path = write_temp(&tag);
        let got = read_id3v2_dates(&path).expect("read").expect("some dates");
        assert_eq!(got.tdrc.as_deref(), Some("1997"));
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn non_id3_and_truncated_inputs_return_none_not_panic() {
        for bytes in [
            b"NOTATAG".to_vec(),
            vec![],
            b"ID3".to_vec(),
            b"ID3\x04\x00\x00".to_vec(),
        ] {
            let path = write_temp(&bytes);
            assert!(read_id3v2_dates(&path).expect("read").is_none());
            std::fs::remove_file(&path).ok();
        }
    }

    #[test]
    fn unsynchronised_tags_are_skipped_rather_than_misparsed() {
        let mut tag = build_tag(4, &[("TDRC", &latin1("1997"))]);
        tag[5] |= 0x80;
        let path = write_temp(&tag);
        assert!(read_id3v2_dates(&path).expect("read").is_none());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn a_tag_without_date_frames_yields_none() {
        let tag = build_tag(4, &[("TPE1", &latin1("Radiohead"))]);
        let path = write_temp(&tag);
        assert!(read_id3v2_dates(&path).expect("read").is_none());
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn synchsafe_decoding_is_correct() {
        assert_eq!(synchsafe(&[0, 0, 0, 0x7F]), 127);
        assert_eq!(synchsafe(&[0, 0, 1, 0]), 128);
        assert_eq!(be_u32(&[0, 0, 1, 0]), 256);
    }
}
