//! What `./add` does when the library already has an artist with the name being added (docs/scripts/add.md,
//! "Same name, different artist"). Identity is the MusicBrainz id, so a shared name alone never blocks an add;
//! the only question is whether one of the existing same-named artists already *is* the one being added.

/// One primary artist already under the name's base slug.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    pub id: String,
    pub mbid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AddDecision {
    /// The group's unidentified member turned out to be this artist: give it the id, create nothing.
    LinkExisting { artist_id: String },
    /// Create the new artist. `identify` first stores what the unidentified member turned out to be, when that is
    /// another artist.
    Create { identify: Option<(String, String)> },
}

/// Decide, given the name's current members, what the unidentified member (if any) was identified as, and the id
/// being added. An existing row with this very id is handled before this (exit 3). Pure.
///
/// `identified`: `None` when there is no unidentified member; `Some(None)` when it could not be identified;
/// `Some(Some(id))` when its albums point at `id`.
pub fn decide(members: &[Member], identified: Option<Option<String>>, adding: &str) -> AddDecision {
    let unidentified = members.iter().find(|m| m.mbid.is_none());
    match (unidentified, identified) {
        (Some(u), Some(Some(id))) if id == adding => AddDecision::LinkExisting {
            artist_id: u.id.clone(),
        },
        (Some(u), Some(Some(id))) => AddDecision::Create {
            identify: Some((u.id.clone(), id)),
        },
        _ => AddDecision::Create { identify: None },
    }
}

/// The folder a new artist gets under MUSIC_DIR: its name, or - when a folder by that name already belongs to a
/// same-named artist - its name with the same id token its slug carries, `Napa (9f3423ee)`.
pub fn folder_for(name_folder: &str, mbid: &str, bare_taken: bool) -> String {
    if !bare_taken {
        return name_folder.to_string();
    }
    let token: String = mbid
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_lowercase();
    format!("{} ({})", name_folder, token)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(id: &str, mbid: Option<&str>) -> Member {
        Member {
            id: id.into(),
            mbid: mbid.map(Into::into),
        }
    }

    #[test]
    fn an_identified_namesake_never_blocks_the_add() {
        assert_eq!(
            decide(&[m("pt", Some("PT"))], None, "CL"),
            AddDecision::Create { identify: None }
        );
    }

    #[test]
    fn the_unidentified_member_that_is_this_artist_is_linked_instead_of_duplicated() {
        assert_eq!(
            decide(&[m("u", None)], Some(Some("CL".into())), "CL"),
            AddDecision::LinkExisting {
                artist_id: "u".into()
            }
        );
    }

    #[test]
    fn the_unidentified_member_that_is_someone_else_is_identified_and_the_add_goes_ahead() {
        assert_eq!(
            decide(&[m("u", None)], Some(Some("PT".into())), "CL"),
            AddDecision::Create {
                identify: Some(("u".into(), "PT".into()))
            }
        );
    }

    #[test]
    fn an_unidentifiable_member_stays_as_it_is() {
        assert_eq!(
            decide(&[m("u", None), m("pt", Some("PT"))], Some(None), "CL"),
            AddDecision::Create { identify: None }
        );
    }

    #[test]
    fn a_taken_folder_gets_the_id_token() {
        assert_eq!(
            folder_for("Napa", "9f3423ee-debe-48ec-b78d-281438aaf626", true),
            "Napa (9f3423ee)"
        );
        assert_eq!(
            folder_for("Napa", "9f3423ee-debe-48ec-b78d-281438aaf626", false),
            "Napa"
        );
    }
}
