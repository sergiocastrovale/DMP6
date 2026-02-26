# Folder structure

Reports will be created with structure:

analysis_[timestamp]
analysis_[timestamp]/css
analysis_[timestamp]/css/styles.css
analysis_[timestamp]/index.html (main file)
analysis_[timestamp]/pages/issues.html
analysis_[timestamp]/pages/critical.html
analysis_[timestamp]/pages/mb.html
analysis_[timestamp]/pages/discogs.html
analysis_[timestamp]/pages/ids.html
analysis_[timestamp]/pages/other.html
analysis_[timestamp]/pages/itunes.html

# Files

## index.html

Entry point for the report.

## issues.html

Merges two contexts: 'needs review' and 'unreadable'.

Path to file, what the problem is ("Only one file" or "No audio files", "Could not read header" [get the read error here]).

## critical.html

Path to file, Artist, Title, Year.

## mb.html

Only musicbrainz fields.

Path to file, MB Artist, MB Track, MB Album.

## discogs.html

Only Discogs fields.

Path to file, MB Artist, MB Track, MB Album.

## ids.html

Other identifiers.

Acoustic ID, SongKong ID, Bandcamp, Wikipedia

## other.html

Other fields.

Genre, BMP, Mood, Album art, ISRC, Disc number, Track Number, Track Total

## itunes.html

iTunes specific fields. All that starts with `----:COM.APPLE.ITUNES:`.

# UI

All lists should show the fill path as text, instead of a  nested navigation like we currently have for eg 'missing fields'. It's imperative that we can quickly review without having to click to expand.

Only the erroneous files should appear on the list. If a given folder/files are OK, don't print them in the report.

Clearly explain what the missing things are: if a field is blank, show a X icon, invalid show a warning icon, other things show a ? icon.

Each of the files should have tabs which are static links that open other files. index.html should be a synopsis of all problems found (how many files scanned, how many problems, and a list of total findings per problem or missing field).

# Operations

Calling the script without any arguments should always generate all HTML files unless we call with a new argument `--no-report` which skips building the report entirely.

We should have an argument for each tab prefixed with `--only`: , `--only-issues`, `--only-critical`, `--only-mb`, `--only-discogs`, `--only-ids`, `--only-other`, `--only-itunes`. Running with these should only create the corresponding html files (index.html should be built accordingly). We can pair multiple `--only` commands e.g. `--only-mb --only-ids`.

`--quarantine` should work exactly the same as we have now. Same for `--end-quarantine` and `--quarantine-dry`.

`--limit`, `--from`, `--to`, `--only` should work the same way.

Ask me questions if something is unclear.