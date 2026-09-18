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

I see 3 exactly equal "Dear Michael: The Motown Collection" releases grouped. How is this possible? Clearly a bug. Note: sync and tidy scripts have ran fully. 

UI

Better hierarchy in statistics vs subpages

"Connected now" panel in settings/users needs more love

TIDY

Add proper eslint and apply everywhere