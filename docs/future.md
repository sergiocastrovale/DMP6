# Ideas and future features

LIBRARY

remove all singles, bootlegs for extra space

Before full backup to external drive: Build a script (check if `sync --only-write-mb-to-files` already does this all) that goes through EVERY release and, for every file and if no release MB ID is found, takes that MB ID from the DB and writes it into the metadata of the file. This prevents us having to go fishing for MB IDs again and again by querying Musicbrainz every time we need to nuke the DB and re-sync.

Full setup script: use old laptop and make a script that configures EVERYTHING for a new user. Maybe make it a release-ready bundle (no git clone)?

FEATURES

Standardize output format, iconography, and styling across all Rust scripts (`index`, `sync`,  `audit`, `fix`, etc.) so terminal output looks consistent regardless of which one is running. This should also cater to the UI-version of the scripts' output.

Huge feature: allow people to configure the type of releases they want to allow (e.g. 'Singles'). This would affect everything, from scripts, to UI filtering, to settings, to downloads.

Bind volume levelling from ReplayGain tags. The value is already read and shown in the track info dialog, but the player doesn't use it. This should be a toggle in a new settings/player page (make it the 3rd tab).

Add gapless playback and crossfade, off by default for albums. Configurable in settings/player page.

I want to think about lyrics. Where can we get them from? I'd like to have a ./write-lyrics script that enbeds them in the actual files, and another ./lyrics that reads and injects in the DB. How can we use LRCLIB?

Pull front and back covers, booklets and higher-resolution images from the Cover Art Archive, with a gallery on the release page

Writing MB IDs back into files. sync --only-write-mb-to-files already exists; make it a scheduled job before backups.

Import lists. Automatically monitor artists from Last.fm top artists, Lidarr, ListenBrainz, Spotify follows or playlists, and similar artists of ones you already own (via /add).

BUGS

Disabiguating artists: NAPA's catalogue features both portuguese and chilean band in one catalogue. These catalogues should be separated - best strategy? The name of the band isn't the problem - it's the slug generation and the way we catalogue them (they can't be together).

multi-disk albums that are not all in a parent folder will never be seen as part of the same box set / collection. Must fix in folders

3 identical "Dear Michael: The Motown Collection" cards — diagnosed, not fixed: the album matcher bound three separate 9-12 track albums to one 257-track box. See `docs/sync_decisions.md` §19 item 7.

Compilations owned by dozens of unrelated artists (a Harold Land compilation on Lana Del Rey's page) — scattered per-track artist tags; index ownership. See `docs/sync_decisions.md` §19 item 8.

124 "Chronological Classics" bindings whose files agree on the wrong volume — retag the files. List: `docs/specs/spec_tidy_observations_cc_retag.tsv`, background in `docs/sync_decisions.md` §19 item 9.

(Fixed 2026-09-18 and removed from this list: 22-20s "Got It If You Want It" disc 1 + disc 2 shown as two cards — `docs/sync_decisions.md` §9; "Harold in the Land of Jazz" / Chronological Classics compilations bound to the wrong album by scattered tags — §7. Full open-bug list: §19.)


UI

Better hierarchy in statistics vs subpages

"Connected now" panel in settings/users needs more love

if downloads are paused, re-download button in artist page should be disabled with Popover.vue explaining why

In downloads page "1 release have no MusicBrainz release date and can never be auto-acquired." -> which one(s)? Change to: "The following releases have no MusicBrainz release date and can never be auto-acquired: {unordered list of artist - release}" 

TIDY

Add proper eslint and apply everywhere

docs are all over the place. We need one consistent doc with the entire flow and ifs / trade-offs - from index to sync to tidy. What decisions do we make? Why and how? Are they because of faulty metadata or true problems with grouping / UI display that we need to tackle even with pristine metadata (particularly in compilations, multi-disk albums, box-sets)? Are we logging the output of each script? Where? Make it bullet-point and almost pseudo-code based - e.g. "1. We find a multi-disk release 2. We then test against X 2.1 Is it Y? Then ...". For each of the inner flows and decision making, also include a mermaid / markdown diagram. Make it SUPER simple to understand for non-technical people. 