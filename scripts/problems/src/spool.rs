//! Append-only row spool plus an atomic checkpoint, so a multi-hour scan survives being killed.
//!
//! XLSX cannot be appended to, so the expensive part (walking and parsing millions of files) is
//! decoupled from the cheap part (writing the workbook). Rows land in an NDJSON spool as they are
//! produced; the report is generated from that spool at the end, or later via `--report-only`.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// One output row: exactly the three columns the report has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Row {
    /// Release folder, relative to the scan root.
    pub path: String,
    /// File name only.
    pub file: String,
    /// Severity-prefixed reasons, `; `-joined.
    pub reason: String,
}

/// Checkpoint written after every completed batch.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanState {
    pub version: u32,
    pub root: String,
    /// Hash of the filter arguments. Resuming a `--only X` run into a full-library run would
    /// produce a report covering neither, so the two are not allowed to mix.
    pub filter_key: String,
    /// Last artist folder *fully* completed. Resume restarts after this one.
    pub last_artist: Option<String>,
    pub artists_done: u64,
    pub files_scanned: u64,
    pub problem_files: u64,
    /// Persisted so the Summary sheet's totals stay correct across a resume - without these the
    /// report silently undercounts every figure that is not files/artists.
    #[serde(default)]
    pub problem_instances: u64,
    #[serde(default)]
    pub folders: u64,
    /// Exact spool length at checkpoint time. See [`SpoolWriter::open_for_resume`].
    pub spool_bytes: u64,
    pub started_at: String,
    pub updated_at: String,
}

pub const STATE_VERSION: u32 = 1;

impl ScanState {
    pub fn new(root: &str, filter_key: &str) -> Self {
        let now = chrono::Local::now().to_rfc3339();
        Self {
            version: STATE_VERSION,
            root: root.to_string(),
            filter_key: filter_key.to_string(),
            last_artist: None,
            artists_done: 0,
            files_scanned: 0,
            problem_files: 0,
            problem_instances: 0,
            folders: 0,
            spool_bytes: 0,
            started_at: now.clone(),
            updated_at: now,
        }
    }
}

pub struct Paths {
    pub spool: PathBuf,
    pub state: PathBuf,
    /// The fixed-row ledger (`fixed.rs`) - shared by every `--fix:*` kind.
    pub fixed: PathBuf,
}

impl Paths {
    pub fn in_dir(dir: &Path) -> Self {
        Self {
            spool: dir.join("problems.spool.jsonl"),
            state: dir.join("problems.state.json"),
            fixed: dir.join("problems.fixed.jsonl"),
        }
    }
}

pub fn load_state(path: &Path) -> Option<ScanState> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

/// Write the checkpoint atomically: a partially-written state file would be worse than none.
pub fn save_state(path: &Path, state: &ScanState) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(state)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)
}

pub struct SpoolWriter {
    file: BufWriter<File>,
    bytes: u64,
}

impl SpoolWriter {
    /// Start a fresh spool, discarding anything already there.
    pub fn create(path: &Path) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(path)?;
        Ok(Self {
            file: BufWriter::new(file),
            bytes: 0,
        })
    }

    /// Reopen an existing spool for resume, truncated to the last checkpoint.
    ///
    /// This truncation is what makes resume *exact* rather than approximate. Rows are flushed and
    /// fsynced before the state file is renamed into place, so a crash in that window leaves the
    /// spool longer than the checkpoint records - containing rows from a batch that was never
    /// counted. Cutting back to `spool_bytes` removes exactly those, so the resumed run neither
    /// duplicates nor loses a row.
    pub fn open_for_resume(path: &Path, spool_bytes: u64) -> std::io::Result<Self> {
        let file = OpenOptions::new().write(true).read(true).open(path)?;
        file.set_len(spool_bytes)?;
        let mut file = file;
        use std::io::Seek;
        file.seek(std::io::SeekFrom::Start(spool_bytes))?;
        Ok(Self {
            file: BufWriter::new(file),
            bytes: spool_bytes,
        })
    }

    pub fn write_rows(&mut self, rows: &[Row]) -> std::io::Result<()> {
        for row in rows {
            let line = serde_json::to_string(row)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
            self.file.write_all(line.as_bytes())?;
            self.file.write_all(b"\n")?;
            self.bytes += line.len() as u64 + 1;
        }
        Ok(())
    }

    /// Flush to the OS and then to disk. Must happen before the state file is written, or the
    /// truncation invariant above does not hold.
    pub fn sync(&mut self) -> std::io::Result<()> {
        self.file.flush()?;
        self.file.get_ref().sync_data()
    }

    pub fn bytes(&self) -> u64 {
        self.bytes
    }
}

/// Stream rows back out of the spool. Skips malformed lines rather than aborting - a truncated
/// final line from a hard kill should not cost the whole report.
pub fn read_rows(path: &Path) -> std::io::Result<impl Iterator<Item = Row>> {
    let file = File::open(path)?;
    Ok(BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Row>(&line).ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn temp_dir() -> PathBuf {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "problems-spool-{}-{}",
            std::process::id(),
            SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    fn row(n: usize) -> Row {
        Row {
            path: format!("Artist/Album {n}"),
            file: format!("{n:02}.mp3"),
            reason: "CRITICAL: something".into(),
        }
    }

    #[test]
    fn rows_round_trip_through_ndjson() {
        let dir = temp_dir();
        let p = Paths::in_dir(&dir);
        let mut w = SpoolWriter::create(&p.spool).expect("create");
        // Values that would break a naive line-based or CSV format.
        let tricky = Row {
            path: "Artist/Album \"Live\"".into(),
            file: "01\tweird\nname.mp3".into(),
            reason: "LOW: emoji 🎵 and, commas; semicolons".into(),
        };
        w.write_rows(&[row(1), tricky.clone()]).expect("write");
        w.sync().expect("sync");

        let got: Vec<Row> = read_rows(&p.spool).expect("read").collect();
        assert_eq!(got.len(), 2);
        assert_eq!(got[1], tricky);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resume_truncation_drops_exactly_the_uncheckpointed_rows() {
        // The core resume invariant. Write 5 rows, checkpoint, write 5 more (simulating a batch
        // that was flushed but whose state rename never happened), then resume and confirm the
        // uncounted 5 are gone and the counted 5 survive intact.
        let dir = temp_dir();
        let p = Paths::in_dir(&dir);

        let mut w = SpoolWriter::create(&p.spool).expect("create");
        let first: Vec<Row> = (0..5).map(row).collect();
        w.write_rows(&first).expect("write");
        w.sync().expect("sync");
        let checkpoint = w.bytes();

        let second: Vec<Row> = (5..10).map(row).collect();
        w.write_rows(&second).expect("write");
        w.sync().expect("sync");
        drop(w);

        assert_eq!(read_rows(&p.spool).expect("read").count(), 10);

        let w2 = SpoolWriter::open_for_resume(&p.spool, checkpoint).expect("resume");
        assert_eq!(w2.bytes(), checkpoint);
        drop(w2);

        let after: Vec<Row> = read_rows(&p.spool).expect("read").collect();
        assert_eq!(after.len(), 5, "resume did not truncate to the checkpoint");
        assert_eq!(after, first);

        let raw = std::fs::read(&p.spool).expect("read raw");
        assert_eq!(raw.last(), Some(&b'\n'), "truncation left a partial line");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn resumed_writer_appends_after_the_truncation_point() {
        let dir = temp_dir();
        let p = Paths::in_dir(&dir);
        let mut w = SpoolWriter::create(&p.spool).expect("create");
        w.write_rows(&[row(1)]).expect("write");
        w.sync().expect("sync");
        let checkpoint = w.bytes();
        w.write_rows(&[row(99)]).expect("write");
        w.sync().expect("sync");
        drop(w);

        let mut w2 = SpoolWriter::open_for_resume(&p.spool, checkpoint).expect("resume");
        w2.write_rows(&[row(2)]).expect("write");
        w2.sync().expect("sync");
        drop(w2);

        let got: Vec<Row> = read_rows(&p.spool).expect("read").collect();
        assert_eq!(
            got,
            vec![row(1), row(2)],
            "resumed rows were not appended cleanly"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn state_round_trips_and_writes_atomically() {
        let dir = temp_dir();
        let p = Paths::in_dir(&dir);
        let mut st = ScanState::new("/music", "abc123");
        st.last_artist = Some("Radiohead".into());
        st.files_scanned = 4242;
        st.spool_bytes = 999;
        save_state(&p.state, &st).expect("save");

        let got = load_state(&p.state).expect("load");
        assert_eq!(got.last_artist.as_deref(), Some("Radiohead"));
        assert_eq!(got.files_scanned, 4242);
        assert_eq!(got.spool_bytes, 999);
        assert_eq!(got.filter_key, "abc123");
        // The temp file must not be left behind.
        assert!(!p.state.with_extension("json.tmp").exists());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_corrupt_trailing_line_does_not_lose_the_whole_spool() {
        let dir = temp_dir();
        let p = Paths::in_dir(&dir);
        let mut w = SpoolWriter::create(&p.spool).expect("create");
        w.write_rows(&[row(1), row(2)]).expect("write");
        w.sync().expect("sync");
        drop(w);
        // Simulate a hard kill mid-write.
        let mut f = OpenOptions::new()
            .append(true)
            .open(&p.spool)
            .expect("open");
        f.write_all(b"{\"path\":\"trunc").expect("write");
        drop(f);

        assert_eq!(read_rows(&p.spool).expect("read").count(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_state_loads_as_none() {
        let dir = temp_dir();
        assert!(load_state(&Paths::in_dir(&dir).state).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }
}
