use crate::mb_types::MbReleaseGroup;

const SKIP_PRIMARY: &[&str] = &["Single"];
const SKIP_SECONDARY: &[&str] = &["Bootleg", "Demo", "Interview", "Broadcast", "Mixtape/Street"];

pub fn should_skip_release(rg: &MbReleaseGroup) -> bool {
    if let Some(ref pt) = rg.primary_type {
        if SKIP_PRIMARY.iter().any(|s| pt.eq_ignore_ascii_case(s)) {
            return true;
        }
    }
    if let Some(ref secondary) = rg.secondary_types {
        for st in secondary {
            if SKIP_SECONDARY.iter().any(|s| st.eq_ignore_ascii_case(s)) {
                return true;
            }
        }
    }
    false
}
