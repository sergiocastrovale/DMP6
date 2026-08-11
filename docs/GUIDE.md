# DMP User Guide

How to keep the catalogue in step with the files on disk, from the UI. Every button here runs one of
the Rust binaries in the background and streams its output to the terminal sidebar (or the compact
progress panel when *Settings → Library → Show terminal sidebar* is off).

## What is automatic and what is not

| Event | Automatic? | Where you act |
|---|---|---|
| New artist folder copied into `MUSIC_DIR` | Only with auto-scan on | Settings → Library → **Check for new files** |
| New releases added to an existing artist | Only with auto-scan on | Artist page → **Scan catalogue** → Check for new files |
| Files replaced in place (same filename) | No | **Re-check changed files** |
| Files replaced with a new filename / whole folder swapped | No | **Full re-scan** (ADMIN) |
| Releases acquired by the downloader | Yes | Merge runs `index` + `sync` for you |
| Deleting an artist | No | Artist page → **Remove** |

**Auto-scan** (Settings → Library → *Scan automatically*) runs `index` + `sync` unattended every N
hours, minimum 1. It only runs on the instance started with `MONITOR_PRIMARY=true`, and it waits for
any other running script, so it never collides with a manual scan.

**Permissions**: MANAGER can run *Check for new files*, *Re-check changed files*, *Index only*, *Sync
only*, *Catalogue gaps*. *Full re-scan* and *Remove artist* are ADMIN-only — the server rejects the
destructive flags (`--overwrite*`, `--prune`, `--files`, `--delete`) for anyone else, even by a forged
request.

---

## 1. I added a new artist folder

1. Copy the folder under `MUSIC_DIR` (metadata is what counts — folder names are never parsed for
   artist, album or year).
2. Go to **Settings → Library**.
3. Click **Check for new files**. This runs `./index` (reads tags, extracts covers) then `./sync`
   (matches against MusicBrainz, fills genres, images, country, release status).
4. Watch the progress panel; the run is finished when it reports `Done.`
5. Open **/browse** — the artist is there. The artist grid is cached for 2 minutes, so give it one
   refresh if it seems late.

Not automatic unless you turn on *Scan automatically* in the same page.

CLI equivalent: `./index && ./sync`, or `./refresh`.

## 2. I want to delete an artist — and optionally their files

1. Open the artist page.
2. Click **Remove** (ADMIN only).
3. The dialog asks to remove them from the catalogue. Leave **Remove all files from this artist**
   unchecked to keep the audio on disk; tick it to delete the files too.
4. Confirm. The terminal streams the deletion plan and result.
5. You land back on **/browse**.

What is deleted either way: the artist's local releases and tracks, their MusicBrainz releases, artist
and cover images (local + S3), **favorites and playlist entries for those tracks**, plus any co-artist
whose entire catalogue was inside the deletion set.

Collaborations: a track owned by *another* artist is not touched — only this artist's credit on it
disappears. And if the artist you delete is still credited on other artists' tracks, the artist row
itself survives as a **credit-only** artist (they own nothing, but still "appear on" those releases);
the plan says so before you confirm.

With the checkbox ticked, only paths that resolve inside `MUSIC_DIR` are deleted, plus the folders they
leave empty. Anything outside is skipped and reported. This is not recoverable by re-scanning.

CLI equivalent: `./delete "Artist Name"` (add `--files` to delete audio, `--dry-run` to preview).
`./nuke --only "Artist Name"` is the older, DB-only variant.

## 3. I added releases to an artist I already have

1. Open the artist page.
2. **Scan catalogue → Check for new files**. It indexes only that artist's folders and syncs only that
   artist, so it takes seconds rather than a library pass.
3. The new releases appear in the release list with a status chip (Complete, Missing tracks, …).
4. If MusicBrainz knows releases you do not own, use **Scan catalogue → Catalogue gaps** to list them
   as *Missing* (1 API call per artist).

CLI equivalent: `./refresh --only "Artist Name"`.

## 4. I replaced corrupted or wrong files

A normal scan **skips any file path already in the database**, so replacing files is the one case where
"Check for new files" does nothing. Pick by what changed:

| What you did | Action | Why |
|---|---|---|
| Overwrote the files, same names | **Re-check changed files** | Compares size/mtime/hash and re-reads changed tags (`./index --inspect`) |
| Re-encoded/renamed (e.g. mp3 → flac), or swapped the whole folder | **Full re-scan** (ADMIN) | Re-reads every tag, re-extracts covers and prunes rows for files that are gone |
| Only fixed tags with an external tool | **Re-check changed files** | Same as above; no need for the destructive pass |

Then, if the release matched differently, run **Sync only** to rematch it.

**Favorites, playlists and play counts**: a track is identified by its file path.

- Same path ⇒ the row is updated: favorite, playlist entries and play count all survive.
- New path ⇒ it is a *new* track and the old row is deleted, taking its favorite, its playlist entries
  and its play count with it. The run reports this as an amber notice
  (`N favorite(s) and M playlist entry(ies) were removed…`) after it finishes, so re-add them by hand.
- Favorited *releases* survive as long as the release folder keeps its path — the folder is the release
  identity, not the files inside it.

CLI equivalent: `./index --inspect`, or `./index --only "Name" --exact --overwrite-with-images --prune`
followed by `./sync --only "Name" --exact --overwrite`.

## 5. I added an artist whose tags match an artist I already have

Artists are keyed by name (slug), and MusicBrainz decides identity — not punctuation in the tags.

- **Same name**: no new artist is created. The releases appear on the existing artist's page after the
  scan, and compilations link to every album-artist they credit.
- **A name variant sharing the same MusicBrainz ID** (e.g. "Beyoncé" vs "Beyonce"): `sync` connects the
  variant to the artist you already have (`primaryArtistId`). The variant is hidden from /browse and
  its releases are shown on the primary artist's page. Nothing to do.
- **Credits**: an artist that only appears in track credits gets an "appears on" entry, not a
  discography. Owning a release and being credited on a track are separate things.
- **A true duplicate with no shared MB ID**: run `./audit --duplicates` (or the **Run audit** button on
  **/issues**), review the pairs on **/issues/duplicates**, queue the ones you want, then run
  `./fix --duplicates`. The merge re-points every release and credit from B to A and deletes B; it
  cannot be reverted.

CLI equivalent: `./sync --only "Name" --exact`, then the audit/fix loop above.
