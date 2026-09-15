# Ideas and future features
- Standardize output format, iconography, and styling across all Rust scripts (`index`, `sync`,
  `audit`, `fix`, etc.) so terminal output looks consistent regardless of which one is running.



GENERAL

all pages mobile friendly

review all scripts: output and feel should look the same but as concise as possible (users will see it in web format)

remove all singles if need space


FEATURES

Genius API to get trivia from releases, tracks

BUGS

Disabiguating artists: NAPA's catalogue features both portuguese and chilean band in one catalogue. These catalogues should be separated - best strategy? The name of the band isn't the problem - it's the slug generation and the way we catalogue them (they can't be together).


UI


LIBRARY

Before full backup to external drive: Build a script that goes through EVERY release and, for every file and if no release MB ID is found, takes that MB ID from the DB and writes it into the metadata of the file. This prevents us having to go fishing for MB IDs again and again by querying Musicbrainz every time we need to nuke the DB and re-sync.
