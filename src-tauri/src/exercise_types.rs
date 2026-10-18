//! The exercise types this build knows (roadmap 7.3, D-30). Since schema v16
//! the database has no CHECK on `exercise_definitions.type`, so this list is
//! the only gate: a new format adds its type here and to `ExerciseType` in
//! `src/lib/ipc/schemas.ts`, with no database change.

/// The four core exercises, then the drills of M10 (each its own type, D-30).
pub const KNOWN: &[&str] = &[
    "repeat", "thought_groups", "imitate", "expression",
    "jam", "roulette", "word_bomb", "three_ways", "emphasis", "pace_ladder", "story_spine", "story_cubes", "pitch", "steelman", "daily", "gauntlet", "boss",
    // The learning engine (M11): saying a phrase aloud during review.
    "phrase_say_it",
    // The conversation partner (M13): your turns in a conversation, and an
    // upgrade loop's shadow and retell takes.
    "conversation", "upgrade",
];

/// Drill types (M10): their first saved take of a session earns `drill_round`.
pub fn is_drill(kind: &str) -> bool {
    is_known(kind) && !matches!(kind, "repeat" | "thought_groups" | "imitate" | "expression" | "phrase_say_it" | "conversation" | "upgrade")
}

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
        assert!(is_known("jam") && is_drill("jam") && is_drill("boss"));
        assert!(!is_drill("repeat") && !is_drill("upgrade") && !is_drill("phrase_say_it") && is_known("phrase_say_it"));
        assert!(is_known("conversation") && is_known("upgrade") && !is_drill("conversation"), "M13's formats are not drills");
        assert!(!is_known("rehearsal"), "later formats are added with their milestones");
        assert!(!is_known(""));
        assert!(!is_known("Repeat"));
    }
}
