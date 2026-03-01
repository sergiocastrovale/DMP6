-- Migration: Rename MusicBrainz tables to UpperCamelCase to match all other tables
ALTER TABLE musicbrainz_releases RENAME TO "MusicBrainzRelease";
ALTER TABLE musicbrainz_release_tracks RENAME TO "MusicBrainzReleaseTrack";
