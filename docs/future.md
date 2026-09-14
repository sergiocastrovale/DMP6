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


BUGS

Artist Damageplan shows an unmatched "Uncivilization" (Feat. Corey Taylor, Slitheryn, Soulfly, Snot, Biohazard). What is this release? It should the cover image as 'Soulfly - Jumpdafuckup' album. Confirm if bad metadata or bad matching bug with MB. Cover is definitely wrong.

a while ago you made it so claim_owned_bundle handles the "one folder covering an extra MB release" cases. I want to revisit this as it might be tremendously flawed. First: what are we even fixing with this? Give solid examples. 

Disabiguating artists: NAPA's catalogue features both portuguese and chilean band in one catalogue. When that happens, always prepend the country name to the artist like "NAPA (PT)". These catalogues should be separated - best strategy?

UI 

toggiling favorites / adding to playlists should update the sidebar counters (or make them appear if zero)


LIBRARY

Before full backup to external drive: Build a script that goes through EVERY release and, for every file and if no release MB ID is found, takes that MB ID from the DB and writes it into the metadata of the file. This prevents us having to go fishing for MB IDs again and again by querying Musicbrainz every time we need to nuke the DB and re-sync.
