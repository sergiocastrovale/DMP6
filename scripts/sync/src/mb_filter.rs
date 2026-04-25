use crate::mb_types::MbReleaseGroup;

const SKIP_TYPES: &[&str] = &["Single", "Bootleg", "Demo", "Interview", "Broadcast", "Mixtape/Street"];

pub fn should_skip_release(rg: &MbReleaseGroup) -> Option<String> {
    if let Some(ref pt) = rg.primary_type {
        if SKIP_TYPES.iter().any(|s| pt.eq_ignore_ascii_case(s)) {
            return Some(pt.clone());
        }
    }
    if let Some(ref secondary) = rg.secondary_types {
        for st in secondary {
            if SKIP_TYPES.iter().any(|s| st.eq_ignore_ascii_case(s)) {
                return Some(st.clone());
            }
        }
    }
    None
}
