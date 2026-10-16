//! Effort points (roadmap 7.4, D-31): what earns XP and how much. Appendix B of
//! the roadmap lists these numbers; XP rewards practising, never how a take
//! sounds. Kinds are validated here rather than by an SQL CHECK, so later
//! milestones add kinds without rebuilding the table.

/// Bumped when amounts or rules change; stored with every event.
pub const RULES_VERSION: u32 = 1;
/// Takes shorter than this earn nothing.
pub const MIN_TAKE_MS: u64 = 10_000;
/// Only the first takes of a session earn XP, so repeating a session can't farm it.
pub const MAX_COUNTED_ORDINAL: u32 = 6;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind {
    TakeSaved,
    Retake,
    SequenceCompleted,
    ReflectionSaved,
    TranscriptReviewed,
    PhraseSaved,
    PhraseReviewed,
    TransferReview,
    BaselineSaved,
}

impl EventKind {
    pub const ALL: [EventKind; 9] = [
        EventKind::TakeSaved,
        EventKind::Retake,
        EventKind::SequenceCompleted,
        EventKind::ReflectionSaved,
        EventKind::TranscriptReviewed,
        EventKind::PhraseSaved,
        EventKind::PhraseReviewed,
        EventKind::TransferReview,
        EventKind::BaselineSaved,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            EventKind::TakeSaved => "take_saved",
            EventKind::Retake => "retake",
            EventKind::SequenceCompleted => "sequence_completed",
            EventKind::ReflectionSaved => "reflection_saved",
            EventKind::TranscriptReviewed => "transcript_reviewed",
            EventKind::PhraseSaved => "phrase_saved",
            EventKind::PhraseReviewed => "phrase_reviewed",
            EventKind::TransferReview => "transfer_review",
            EventKind::BaselineSaved => "baseline_saved",
        }
    }

    pub fn parse(kind: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == kind)
    }

    pub fn xp(self) -> u32 {
        match self {
            EventKind::TakeSaved => 10,
            EventKind::Retake => 5,
            EventKind::SequenceCompleted => 20,
            EventKind::ReflectionSaved => 10,
            EventKind::TranscriptReviewed => 10,
            EventKind::PhraseSaved => 5,
            EventKind::PhraseReviewed => 2,
            EventKind::TransferReview => 30,
            EventKind::BaselineSaved => 20,
        }
    }

    /// Events above this many a day are still recorded, with 0 XP.
    pub fn daily_cap(self) -> Option<u32> {
        match self {
            EventKind::PhraseReviewed => Some(10),
            EventKind::PhraseSaved => Some(5),
            _ => None,
        }
    }
}

/// One thing that earns XP. `ref_id` names what earned it; with the kind it
/// makes the award idempotent.
pub struct NewEvent<'a> {
    pub kind: EventKind,
    pub ref_id: &'a str,
    pub local_date: &'a str,
    pub session_id: Option<&'a str>,
    pub attempt_id: Option<&'a str>,
    pub created_at_ms: i64,
    pub backfilled: bool,
}

/// Whether a saved take earns `take_saved`, and also `retake`.
pub fn take_awards(ordinal: u32, duration_ms: u64) -> (bool, bool) {
    let counts = duration_ms >= MIN_TAKE_MS && (1..=MAX_COUNTED_ORDINAL).contains(&ordinal);
    (counts, counts && ordinal >= 2)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_round_trip_and_amounts_match_the_table() {
        for kind in EventKind::ALL {
            assert_eq!(EventKind::parse(kind.as_str()), Some(kind));
            assert!(kind.xp() <= 1000);
        }
        assert_eq!(EventKind::parse("level_reached"), None, "added with M9");
        let total: u32 = EventKind::ALL.iter().map(|k| k.xp()).sum();
        assert_eq!(total, 112, "update appendix B when amounts change");
    }

    #[test]
    fn takes_need_ten_seconds_and_a_low_ordinal() {
        assert_eq!(take_awards(1, 9_999), (false, false));
        assert_eq!(take_awards(1, 10_000), (true, false));
        assert_eq!(take_awards(2, 60_000), (true, true));
        assert_eq!(take_awards(6, 60_000), (true, true));
        assert_eq!(take_awards(7, 60_000), (false, false));
    }
}
