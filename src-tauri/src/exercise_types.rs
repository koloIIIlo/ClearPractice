//! The exercise types this build knows (roadmap 7.3, D-30). Since schema v16
//! the database has no CHECK on `exercise_definitions.type`, so this list is
//! the only gate: a new format adds its type here and to `ExerciseType` in
//! `src/lib/ipc/schemas.ts`, with no database change.

pub const KNOWN: &[&str] = &["repeat", "thought_groups", "imitate", "expression"];

pub fn is_known(kind: &str) -> bool {
    KNOWN.contains(&kind)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_types_are_known() {
        for kind in KNOWN {
            assert!(is_known(kind));
        }
        assert!(!is_known("jam"), "drill types are added with their drills");
        assert!(!is_known(""));
        assert!(!is_known("Repeat"));
    }
}
