# Ideas and future features
- Standardize output format, iconography, and styling across all Rust scripts (`index`, `sync`,
  `audit`, `fix`, etc.) so terminal output looks consistent regardless of which one is running.



GENERAL

all pages mobile friendly

review all scripts: output and feel should look the same but as concise as possible (users will see it in web format)

remove all singles, bootlegs for extra space


FEATURES

plays are only stored as LocalReleaseTrack.playCount and lastPlayedAt, which every user  shares. There is no table of individual plays per user. we need to change this. Remove from LocalReleaseTrack and add to new LocalReleaseTrackUser (or similar) table. Update all the app and UI accordingly.

PlayEvent table (userId, trackId, when, how much was played, skipped or not). This unlocks per-user stats, a yearly recap, "on this day" and better recommendations, and gives Explore's familiarity score a per-user signal.

Now that we have PlayEvents, add new statistics + detail pages in /statistics: "This year", "This month", "Last week", "Today". The panels should appear right below the total playtime.

Subsonic API. This lets existing apps (Symfonium, Feishin, Substreamer, Sonixd) play from DMP, with offline mode, Android Auto and CarPlay, without building them. It's probably the most value for the least work.

Bind volume levelling from ReplayGain tags. The value is already read and shown in the track info dialog, but the player doesn't use it. This should be a toggle in a new settings/player page (make it the 3rd tab).

Add gapless playback and crossfade, off by default for albums. Configurable in settings/player page.

I want to think about lyrics. Where can we get them from? I'd like to have a ./write-lyrics script that enbeds them in the actual files, and another ./lyrics that reads and injects in the DB. How can we use LRCLIB?

"I own this" + Discogs sync with your account

Pull front and back covers, booklets and higher-resolution images from the Cover Art Archive, with a gallery on the release page

Writing MB IDs back into files. sync --only-write-mb-to-files already exists; make it a scheduled job before backups.

Import lists. Automatically monitor artists from Last.fm top artists, ListenBrainz, Spotify follows or playlists, and similar artists of ones you already own (via /add).

Upcoming-release calendar, fed from MusicBrainz future release dates

Time windows and bandwidth limits (e.g. downloads only at night)



BUGS

Disabiguating artists: NAPA's catalogue features both portuguese and chilean band in one catalogue. These catalogues should be separated - best strategy? The name of the band isn't the problem - it's the slug generation and the way we catalogue them (they can't be together).

UI

Better hierarchy in statistics vs subpages

LIBRARY

Before full backup to external drive: Build a script that goes through EVERY release and, for every file and if no release MB ID is found, takes that MB ID from the DB and writes it into the metadata of the file. This prevents us having to go fishing for MB IDs again and again by querying Musicbrainz every time we need to nuke the DB and re-sync.
