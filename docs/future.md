# Ideas and future features

- Advanced catalogue exploration: filter by decade, mood, intensity in a unified view.
- Non-admin (VIEWER/MANAGER) users hitting a blank catalogue page in some cases — needs
  reproduction + root-causing.
- Standardize output format, iconography, and styling across all Rust scripts (`index`, `sync`,
  `audit`, `fix`, etc.) so terminal output looks consistent regardless of which one is running.

GENERAL

all pages mobile friendly

review all scripts: output and feel should look the same but as concise as possible (users will see it in web format)

remove all singles if need space

FEATURES

allow removing specific release (button bottom left in info dialog)

BUGS

Artist Damageplan shows an unmatched "Uncivilization" (Feat. Corey Taylor, Slitheryn, Soulfly, Snot, Biohazard). What is this release? It should the cover image as 'Soulfly - Jumpdafuckup' album. Confirm if bad metadata or bad matching bug with MB. Cover is definitely wrong.

we should only show/allow any part of the download flow (including download buttons) if both the final collection folder and any of the paths / tools (like ffmpeg) are available. E.g. locally pointed at the production DB, but without the NAS's /mnt/SSD/Downloads volume mounted (and without ffmpeg on this box's relevant PATH). The staged files aren't gone — they're just not reachable from here so we get an error when merging. 

a while ago you made it so claim_owned_bundle handles the "one folder covering an extra MB release" cases. I want to revisit this as it might be tremendously flawed. First: what are we even fixing with this? Give solid examples. 

scripts/common/src/tags.rs:58 writes the track MBID into ItemKey::MusicBrainzRecordingId, so ./sync --only-write-mb-to-files has been stamping the wrong kind of id into your files. It is a file-writing fix with its own blast radius and belongs in a separate change.

UI


LIBRARY

Before full backup to external drive: Build a script that goes through EVERY release and, for every file and if no release MB ID is found, takes that MB ID from the DB and writes it into the metadata of the file. This prevents us having to go fishing for MB IDs again and again by querying Musicbrainz every time we need to nuke the DB and re-sync.


---

imagine a fake artist A which has EP X (3 tracks), EP Y (4 tracks), Albums B (10 tracks), C (12 tracks), D (16 tracks), E (2 disks: E1 with 9 tracks, E2 with 11 tracks). Box set with EP X, Y and Albums B, C, D + "Rarities" (5 tracks).

How will the algorithm catalogue:

1. A special edition of D which has 17 tracks

2. A special edition of E where E1 has 15 tracks

3. A case where we only have E2 in our collection (not E1)

4. The full box set (including rarities album)

Fake artist B is from the 50s, where it was very normal to release Album A, Album B, and then Album A + B. How would A + B be catalogued? And what if it was A + B + extra bonus tracks?

Assume these questions where you a) have MB release IDs b) don't have them. Tell me very succinctly, no code, which strategy the script would use for each case.