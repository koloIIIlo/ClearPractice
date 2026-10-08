//! First review measures derived from a saved transcript (plan 3.6, 3.7).
//! Everything here is Estimated: it relies on the model's text and segment
//! times, not on voice activity detection. Filler hits are review candidates,
//! never verdicts. Missing values are `None` with a reason, never 0.
use serde::Serialize;

pub const DEFINITION_VERSION: u32 = 1;
/// Pause threshold from §11; stored with the result so it can change later.
pub const PAUSE_THRESHOLD_MS: u64 = 700;
const PACE_MIN_SPAN_MS: u64 = 15_000;
const PACE_MIN_WORDS: usize = 20;
/// Unambiguous hesitation sounds. "Like" and "you know" are left to the user (D-16).
const FILLERS: [&str; 8] = ["uh", "um", "uhm", "umm", "uhh", "er", "erm", "ah"];

pub struct SegmentInput<'a> {
    pub text: &'a str,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FillerCandidate {
    pub segment: usize,
    pub word: String,
    /// Start of the containing segment; word timing is not verified.
    pub segment_start_ms: Option<u64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pause {
    pub after_segment: usize,
    pub start_ms: u64,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Measures {
    pub definition_version: u32,
    pub source: &'static str,
    pub word_count: usize,
    pub speech_span_ms: Option<u64>,
    pub pace_wpm: Option<f64>,
    pub pace_unavailable_reason: Option<String>,
    pub pause_threshold_ms: u64,
    pub pauses: Vec<Pause>,
    pub pauses_unavailable_reason: Option<String>,
    pub fillers: Vec<FillerCandidate>,
    pub repeated_words: Vec<String>,
    /// Segments without usable timing, left out of pace and pauses.
    pub untimed_segments: usize,
}

/// Lowercase word without surrounding punctuation ("Uh," → "uh").
pub fn normalize(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'').to_lowercase()
}

pub fn is_filler(word: &str) -> bool {
    FILLERS.contains(&normalize(word).as_str())
}

pub fn measure(segments: &[SegmentInput]) -> Measures {
    let mut fillers = Vec::new();
    let mut repeated = Vec::new();
    let mut words = 0usize;
    let mut timed_words = 0usize;
    let mut previous: Option<String> = None;
    for (index, segment) in segments.iter().enumerate() {
        let timed = segment.start_ms.is_some() && segment.end_ms.is_some();
        for raw in segment.text.split_whitespace() {
            let word = normalize(raw);
            if word.is_empty() {
                continue;
            }
            if FILLERS.contains(&word.as_str()) {
                fillers.push(FillerCandidate { segment: index, word, segment_start_ms: segment.start_ms });
                continue;
            }
            words += 1;
            if timed {
                timed_words += 1;
            }
            if previous.as_deref() == Some(word.as_str()) {
                repeated.push(word.clone());
            }
            previous = Some(word);
        }
    }

    let timed: Vec<(usize, u64, u64)> = segments
        .iter()
        .enumerate()
        .filter(|(_, s)| !s.text.trim().is_empty())
        .filter_map(|(i, s)| Some((i, s.start_ms?, s.end_ms?)))
        .collect();
    let spoken = segments.iter().filter(|s| !s.text.trim().is_empty()).count();
    let untimed = spoken - timed.len();
    let span = (!timed.is_empty()).then(|| timed.last().unwrap().2.saturating_sub(timed[0].1));

    let (pace, pace_reason) = match span {
        None => (None, Some("Segment timings are unavailable.".to_string())),
        Some(ms) if ms < PACE_MIN_SPAN_MS => (None, Some("Needs at least 15 seconds of speech.".into())),
        Some(_) if timed_words < PACE_MIN_WORDS => (None, Some("Needs at least 20 words.".into())),
        Some(ms) => (Some((timed_words as f64 * 60_000.0 / ms as f64 * 10.0).round() / 10.0), None),
    };

    let (pauses, pauses_reason) = if timed.len() >= 2 || (timed.len() == spoken && spoken > 0) {
        // Only neighbouring timed segments: a gap next to an untimed one is unknown.
        let pauses = timed
            .windows(2)
            .filter(|pair| pair[1].0 == pair[0].0 + 1)
            .filter_map(|pair| {
                let gap = pair[1].1.saturating_sub(pair[0].2);
                (gap >= PAUSE_THRESHOLD_MS).then_some(Pause { after_segment: pair[0].0, start_ms: pair[0].2, duration_ms: gap })
            })
            .collect();
        (pauses, None)
    } else {
        (Vec::new(), Some("Segment timings are unavailable.".to_string()))
    };

    Measures {
        definition_version: DEFINITION_VERSION,
        source: "Estimated",
        word_count: words,
        speech_span_ms: span,
        pace_wpm: pace,
        pace_unavailable_reason: pace_reason,
        pause_threshold_ms: PAUSE_THRESHOLD_MS,
        pauses,
        pauses_unavailable_reason: pauses_reason,
        fillers,
        repeated_words: repeated,
        untimed_segments: untimed,
    }
}

/// Silences found in the recording itself (plan 3.5): from the waveform peaks
/// of the original take, so times are on the original timeline and nothing is
/// trimmed. Speech is any bucket above an adaptive threshold between the noise
/// floor and the loudest speech; pauses are quiet runs of at least 700 ms
/// between the first and last speech.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceActivity {
    pub method: &'static str,
    pub source: &'static str,
    pub speech_start_ms: Option<u64>,
    pub speech_end_ms: Option<u64>,
    pub pauses: Vec<Pause>,
    pub unavailable_reason: Option<String>,
}

pub fn voice_activity(peaks: &[u16], samples_per_peak: u32, sample_rate: u32) -> VoiceActivity {
    let method = "peak-energy-v1";
    let ms_per_bucket = u64::from(samples_per_peak) * 1000 / u64::from(sample_rate.max(1));
    let unavailable = |reason: &str| VoiceActivity {
        method,
        source: "Estimated",
        speech_start_ms: None,
        speech_end_ms: None,
        pauses: Vec::new(),
        unavailable_reason: Some(reason.into()),
    };
    if peaks.len() < 10 || ms_per_bucket == 0 {
        return unavailable("The recording is too short to find pauses.");
    }
    let mut sorted = peaks.to_vec();
    sorted.sort_unstable();
    let floor = f64::from(sorted[sorted.len() / 10]);
    let loud = f64::from(sorted[sorted.len() * 95 / 100]);
    if loud < 300.0 || loud < floor * 3.0 {
        return unavailable("No clear speech above the background noise.");
    }
    // Geometric midpoint between noise and speech copes with quiet microphones.
    let threshold = (floor.max(30.0) * loud).sqrt();
    let voiced: Vec<bool> = peaks.iter().map(|p| f64::from(*p) >= threshold).collect();
    let (Some(first), Some(last)) = (voiced.iter().position(|v| *v), voiced.iter().rposition(|v| *v)) else {
        return unavailable("No clear speech above the background noise.");
    };
    let mut pauses = Vec::new();
    let mut run_start: Option<usize> = None;
    for (index, &is_voiced) in voiced.iter().enumerate().take(last + 1).skip(first) {
        match (is_voiced, run_start) {
            (false, None) => run_start = Some(index),
            (true, Some(start)) => {
                let duration = (index - start) as u64 * ms_per_bucket;
                if duration >= PAUSE_THRESHOLD_MS {
                    pauses.push(Pause { after_segment: 0, start_ms: start as u64 * ms_per_bucket, duration_ms: duration });
                }
                run_start = None;
            }
            _ => {}
        }
    }
    VoiceActivity {
        method,
        source: "Estimated",
        speech_start_ms: Some(first as u64 * ms_per_bucket),
        speech_end_ms: Some((last as u64 + 1) * ms_per_bucket),
        pauses,
        unavailable_reason: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_activity_finds_real_silences_on_the_original_timeline() {
        // 100 buckets per second: 0.5 s noise, 2 s speech, 1.2 s pause, 1 s speech, 0.3 s gap, 1 s speech, 0.5 s noise.
        let mut peaks = vec![40u16; 50];
        peaks.extend(vec![9_000; 200]);
        peaks.extend(vec![60; 120]);
        peaks.extend(vec![7_000; 100]);
        peaks.extend(vec![50; 30]);
        peaks.extend(vec![8_000; 100]);
        peaks.extend(vec![40; 50]);
        let v = voice_activity(&peaks, 480, 48_000);
        assert_eq!(v.speech_start_ms, Some(500));
        assert_eq!(v.speech_end_ms, Some(6_000));
        assert_eq!(v.pauses.len(), 1, "the 0.3 s gap is below the threshold");
        assert_eq!((v.pauses[0].start_ms, v.pauses[0].duration_ms), (2_500, 1_200));

        let silence = voice_activity(&vec![40u16; 500], 480, 48_000);
        assert!(silence.unavailable_reason.is_some() && silence.pauses.is_empty());
        assert!(voice_activity(&[1, 2, 3], 480, 48_000).unavailable_reason.is_some());
    }

    fn seg(text: &str, start: u64, end: u64) -> SegmentInput<'_> {
        SegmentInput { text, start_ms: Some(start), end_ms: Some(end) }
    }

    #[test]
    fn finds_fillers_repeats_pauses_and_pace_from_timed_segments() {
        let words = "indexes make reads faster because the database can jump straight to the rows it needs instead of scanning";
        let segments = [
            seg(" Well, uh, I, I think", 0, 2_000),
            seg(words, 2_200, 12_000),
            seg(" Um, so that's the trade-off.", 13_000, 16_000),
        ];
        let m = measure(&segments);
        assert_eq!(m.fillers.iter().map(|f| f.word.as_str()).collect::<Vec<_>>(), ["uh", "um"]);
        assert_eq!(m.fillers[1], FillerCandidate { segment: 2, word: "um".into(), segment_start_ms: Some(13_000) });
        assert_eq!(m.repeated_words, ["i"]);
        assert_eq!(m.pauses, [Pause { after_segment: 1, start_ms: 12_000, duration_ms: 1_000 }]);
        assert_eq!(m.speech_span_ms, Some(16_000));
        assert_eq!(m.word_count, 26);
        assert_eq!(m.pace_wpm, Some(97.5));
        assert!(m.pace_unavailable_reason.is_none());
        assert_eq!(m.untimed_segments, 0);
    }

    #[test]
    fn an_untimed_final_segment_is_left_out_instead_of_hiding_everything() {
        let words = "indexes make reads faster because the database can jump straight to the rows it needs instead of scanning";
        let segments = [
            seg(words, 0, 9_000),
            seg("so the trade-off is that every write also has to update the index", 10_000, 16_000),
            SegmentInput { text: " Uh, that's it.", start_ms: None, end_ms: None },
        ];
        let m = measure(&segments);
        assert_eq!(m.untimed_segments, 1);
        assert_eq!(m.speech_span_ms, Some(16_000));
        assert_eq!(m.pauses, [Pause { after_segment: 0, start_ms: 9_000, duration_ms: 1_000 }]);
        assert_eq!(m.pace_wpm, Some(116.3)); // 31 timed words over 16 s
        assert_eq!(m.fillers.len(), 1, "fillers still count in untimed text");
    }

    #[test]
    fn short_or_untimed_speech_reports_why_values_are_missing() {
        let short = measure(&[seg("Uh, hello there.", 0, 3_000)]);
        assert_eq!(short.pace_wpm, None);
        assert_eq!(short.pace_unavailable_reason.as_deref(), Some("Needs at least 15 seconds of speech."));
        let untimed = measure(&[SegmentInput { text: "Hello", start_ms: None, end_ms: None }]);
        assert_eq!(untimed.speech_span_ms, None);
        assert!(untimed.pauses_unavailable_reason.is_some());
        assert!(!is_filler("like") && is_filler("Uhm,") && !is_filler("umbrella"));
    }
}
