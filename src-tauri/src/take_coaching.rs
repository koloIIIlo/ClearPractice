//! The text of a take's coaching request (M5, P.9). Everything here is
//! measured on this computer and shown in full in the preview before anything
//! is sent; audio never leaves the computer.
use crate::{
    api::coaching::{hide_words, TakeText},
    clipsplit::{annotated_transcript, SentenceInfo},
    storage::database::coaching_runs::TakeInput,
};

type Result<T> = std::result::Result<T, String>;

fn clock(ms: u64) -> String {
    format!("{}:{:02}", ms / 60_000, (ms % 60_000) / 1000)
}

/// Builds the request text: task, conditions, focus, measured summaries, the
/// transcript and, when the take has timed parts, one line of measured
/// delivery per part. Hidden words are replaced everywhere.
pub fn build(input: &TakeInput, parts: &[SentenceInfo], hide: &[String]) -> Result<TakeText> {
    let topic = match input.familiarity.as_deref() {
        Some("unfamiliar") => "unfamiliar (first time on this topic)",
        Some("familiar") => "rehearsed (a familiar topic)",
        _ => "not recorded",
    };
    let mut measured = vec![match input.pace_wpm {
        Some(p) => format!("pace {p:.0} words per minute"),
        None => "pace unavailable (too little timed speech)".into(),
    }];
    if let Some(p) = input.pauses {
        measured.push(format!("{p} {} over 0.7 s", if p == 1 { "pause" } else { "pauses" }));
    }
    measured.push(format!("{} filler {} (uh, um)", input.fillers, if input.fillers == 1 { "candidate" } else { "candidates" }));
    let delivery = if parts.is_empty() {
        "Delivery per part: unavailable (this transcript has no timings).".to_string()
    } else {
        format!(
            "Delivery per part ({}; estimates from this computer; loudness is relative to this take's average voiced loudness):\n{}",
            if input.corrected { "parts of the automatic transcript" } else { "parts of the transcript" },
            annotated_transcript(parts)
        )
    };
    let header = format!(
        "Task: {}\nTopic: {topic}\nTake {} · {} long\nLearner's focus: {}\nMeasured on this computer (estimates): {}.\n\nTranscript ({}):\n",
        input.prompt.as_deref().unwrap_or("not recorded").trim(),
        input.ordinal,
        clock(input.duration_ms),
        input.focus.as_deref().unwrap_or("none chosen").trim(),
        measured.join("; "),
        if input.corrected { "automatic transcription, corrected by the learner" } else { "automatic transcription" },
    );
    let transcript = hide_words(input.text.trim(), hide)?;
    let text = format!("{}{transcript}\n\n{}", hide_words(&header, hide)?, hide_words(&delivery, hide)?);
    Ok(TakeText { attempt_id: input.attempt_id.clone(), revision_id: input.revision_id.clone(), text, transcript, parts: parts.len() })
}

/// The text of a follow-up request (5.11): the task, topic and the take's
/// transcript only. No measures, nothing else from the session.
pub fn follow_up_text(input: &TakeInput) -> Result<TakeText> {
    let text = format!(
        "Task: {}\nTopic: {}\n\nThe learner's answer (automatic transcription{}):\n{}",
        input.prompt.as_deref().unwrap_or("not recorded").trim(),
        match input.familiarity.as_deref() { Some("unfamiliar") => "unfamiliar", Some("familiar") => "familiar", _ => "not recorded" },
        if input.corrected { ", corrected by the learner" } else { "" },
        input.text.trim()
    );
    Ok(TakeText { attempt_id: input.attempt_id.clone(), revision_id: input.revision_id.clone(), text, transcript: input.text.trim().to_string(), parts: 0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input() -> TakeInput {
        TakeInput {
            attempt_id: "take".into(),
            revision_id: "take--1".into(),
            text: "So, uh, an index makes searching more fast. My friend Anna uses it.".into(),
            corrected: false,
            timed_parts: vec![("So, uh, an index makes searching more fast.".into(), 0, 4_000), ("My friend Anna uses it.".into(), 4_600, 7_000)],
            prompt: Some("Explain how a database index works.".into()),
            focus: Some("State the point earlier".into()),
            familiarity: Some("unfamiliar".into()),
            ordinal: 2,
            duration_ms: 72_000,
            pace_wpm: None,
            pauses: Some(1),
            fillers: 1,
        }
    }

    #[test]
    fn the_request_text_holds_task_focus_measures_transcript_and_delivery_and_hides_words() {
        let parts = vec![
            SentenceInfo { index: 1, start_ms: 0, end_ms: 4_000, text: "So, uh, an index makes searching more fast.".into(), ending_semitones: Some(-3.0), range_semitones: Some(6.5), loudness_db: Some(1.0), words_per_minute: Some(120), pause_before_ms: None },
            SentenceInfo { index: 2, start_ms: 4_600, end_ms: 7_000, text: "My friend Anna uses it.".into(), ending_semitones: Some(2.4), range_semitones: None, loudness_db: None, words_per_minute: None, pause_before_ms: Some(600) },
        ];
        let t = build(&input(), &parts, &[]).unwrap();
        assert!(t.text.starts_with("Task: Explain how a database index works.\nTopic: unfamiliar (first time on this topic)\nTake 2 · 1:12 long\nLearner's focus: State the point earlier\n"));
        assert!(t.text.contains("pace unavailable (too little timed speech); 1 pause over 0.7 s; 1 filler candidate (uh, um)."));
        assert!(t.text.contains("[1] 0:00.0–0:04.0 \"So, uh, an index makes searching more fast.\" | ending falling -3.0 st | pitch range 6.5 st | loudness +1 dB | 120 wpm"));
        assert!(t.text.contains("[2] 0:04.6–0:07.0 \"My friend Anna uses it.\" | ending rising +2.4 st | pause before 0.6 s"));
        assert_eq!(t.transcript, input().text);
        assert_eq!(t.parts, 2);

        // Hidden words never reach the text, including the delivery lines.
        let hidden = build(&input(), &parts, &["anna".into(), " ".into()]).unwrap();
        assert!(!hidden.text.contains("Anna"));
        assert_eq!(hidden.text.matches("My friend [hidden] uses it.").count(), 2);
        assert_eq!(hidden.transcript, "So, uh, an index makes searching more fast. My friend [hidden] uses it.");
        assert!(build(&input(), &parts, &vec!["x".to_string(); 21]).is_err());

        // Untimed takes say so instead of inventing delivery.
        let untimed = build(&TakeInput { timed_parts: vec![], corrected: true, prompt: None, focus: None, familiarity: None, ..input() }, &[], &[]).unwrap();
        assert!(untimed.text.contains("Delivery per part: unavailable (this transcript has no timings)."));
        assert!(untimed.text.contains("Task: not recorded\nTopic: not recorded"));
        assert!(untimed.text.contains("Learner's focus: none chosen"));
        assert!(untimed.text.contains("Transcript (automatic transcription, corrected by the learner):"));
        assert_eq!(untimed.parts, 0);
    }
}
