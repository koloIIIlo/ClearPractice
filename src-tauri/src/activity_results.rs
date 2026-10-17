//! Drill results (roadmap M10): pure functions from a take's stored transcript,
//! voice activity, speech rate and marks to numbers and keys (A-30). Everything
//! here is Estimated; a value that needs a missing input is null with a reason.
//! A result never grades the voice: it counts what happened in the take.
use crate::analysis::{self, Measures, Pause, VoiceActivity};
use crate::prosody::Prominence;
use serde_json::{json, Map, Value};

/// Bumped when a rule changes; cached results of older versions are recomputed.
pub const DEFINITION_VERSION: u32 = 1;
/// Pauses at least this long cost Just a Minute time and colour a daily window.
pub const LONG_PAUSE_MS: u64 = 1_500;
const JAM_LIMIT_MS: u64 = 60_000;
const HESITATION_MS: u64 = 1_000;
const REPEAT_MS: u64 = 500;
const FLAG_MS: u64 = 1_000;
/// A word counts as woven in when said from this long before it was shown.
const BOMB_EARLY_MS: u64 = 1_000;
const SPINE_STEPS: u64 = 7;
const DAILY_WINDOW_MS: u64 = 10_000;
const DAILY_WINDOWS: u64 = 6;
/// A daily window with less speech than this is silent.
const MIN_SPEECH_IN_WINDOW_MS: u64 = 500;
const NEEDS_TRANSCRIPT: &str = "Needs a transcript.";

/// A mark made during the take (10.1): the time into the take, a kind and keys or numbers.
#[derive(Clone, Debug, PartialEq)]
pub struct Mark {
    pub at_ms: u64,
    pub kind: String,
    pub data: Map<String, Value>,
}

/// One segment of the take's current transcript (a correction is one untimed segment).
#[derive(Clone, Debug, PartialEq)]
pub struct Segment {
    pub text: String,
    pub start_ms: Option<u64>,
    pub end_ms: Option<u64>,
}

/// Everything a result may read, gathered by `storage::drills`.
pub struct ResultInputs<'a> {
    /// The session's exercise type (`jam`, `word_bomb`…).
    pub kind: &'a str,
    /// The run's settings (7.3): words shown, icons rolled, sentences read.
    pub params: &'a Map<String, Value>,
    pub step_index: Option<u32>,
    pub duration_ms: u64,
    pub segments: Option<Vec<Segment>>,
    pub measures: Option<Measures>,
    pub voice: Option<VoiceActivity>,
    pub rate_sps: Option<f64>,
    pub rate_reason: Option<String>,
    pub marks: Vec<Mark>,
    pub prominence: Option<Prominence>,
}

/// The result of one drill take.
pub fn compute(i: &ResultInputs) -> Value {
    match i.kind {
        "jam" => jam(i),
        "word_bomb" => word_bomb(i),
        "emphasis" => emphasis(i),
        "pace_ladder" => pace_ladder(i),
        "story_cubes" => story_cubes(i),
        "story_spine" => story_spine(i),
        "daily" => daily_grid(i),
        _ => basic(i),
    }
}

/// The numbers of a result, for the facts snapshot (`FactTake.result`).
pub fn numbers(result: &Value) -> std::collections::BTreeMap<String, f64> {
    result
        .as_object()
        .map(|o| {
            o.iter()
                .filter_map(|(k, v)| match v {
                    Value::Number(n) => n.as_f64().map(|n| (k.clone(), n)),
                    Value::Bool(b) => Some((k.clone(), if *b { 1.0 } else { 0.0 })),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
}

fn usable_voice<'a>(i: &'a ResultInputs<'_>) -> Option<&'a VoiceActivity> {
    i.voice.as_ref().filter(|v| v.unavailable_reason.is_none() && v.speech_start_ms.is_some())
}

/// First to last detected speech: from the waveform, else the transcript's span, else the whole take.
fn speech_bounds(i: &ResultInputs) -> (u64, u64) {
    if let Some(v) = usable_voice(i) {
        if let (Some(start), Some(end)) = (v.speech_start_ms, v.speech_end_ms) {
            return (start, end.max(start));
        }
    }
    let span = i.measures.as_ref().and_then(|m| m.speech_span_ms);
    (0, span.unwrap_or(i.duration_ms))
}

/// Pauses of 1.5 s or more: from the waveform when it found speech, else from the transcript's gaps.
fn long_pauses(i: &ResultInputs) -> Vec<Pause> {
    let source = match usable_voice(i) {
        Some(v) => v.pauses.clone(),
        None => i.measures.as_ref().map(|m| m.pauses.clone()).unwrap_or_default(),
    };
    source.into_iter().filter(|p| p.duration_ms >= LONG_PAUSE_MS).collect()
}

fn marks<'a>(i: &'a ResultInputs<'_>, kind: &'a str) -> impl Iterator<Item = &'a Mark> + 'a {
    i.marks.iter().filter(move |m| m.kind == kind)
}

fn param_list(params: &Map<String, Value>, key: &str) -> Vec<String> {
    params.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Stems of the take's words, each with the start of its segment.
fn stemmed_words(segments: &[Segment]) -> Vec<(String, Option<u64>)> {
    segments
        .iter()
        .flat_map(|s| analysis::tokens(&s.text).into_iter().map(move |t| (analysis::stem(&t), s.start_ms)))
        .collect()
}

/// "umbrella|umbrellas" → the stems of each form.
fn form_stems(forms: &str) -> Vec<String> {
    forms.split('|').map(str::trim).filter(|f| !f.is_empty()).map(|f| analysis::stem(&f.to_lowercase())).collect()
}

/// Just a Minute (10.2): the speaking time, at most 60 s, minus one second per
/// hesitation candidate, each long pause's length, half a second per immediate
/// repeat and a second per slip you flagged. Never below zero, rounded down.
fn jam(i: &ResultInputs) -> Value {
    let (start, end) = speech_bounds(i);
    let speaking = end.saturating_sub(start).min(JAM_LIMIT_MS);
    let limit = start + JAM_LIMIT_MS;
    let long: Vec<Pause> = long_pauses(i).into_iter().filter(|p| p.start_ms < limit).collect();
    let long_ms: u64 = long.iter().map(|p| p.duration_ms.min(limit.saturating_sub(p.start_ms))).sum();
    let flags = marks(i, "self_flag").count() as u64;
    let hesitations = i.measures.as_ref().map(|m| m.fillers.len() as u64);
    let repeats = i.measures.as_ref().map(|m| m.repeated_words.len() as u64);
    let clean = match (hesitations, repeats) {
        (Some(h), Some(r)) => Some(speaking.saturating_sub(h * HESITATION_MS + long_ms + r * REPEAT_MS + flags * FLAG_MS) / 1000),
        _ => None,
    };
    json!({
        "kind": "jam", "speakingMs": speaking, "cleanSeconds": clean, "hesitations": hesitations, "longPauses": long.len(),
        "longPauseMs": long_ms, "repeats": repeats, "flags": flags,
        "unavailableReason": clean.is_none().then_some(NEEDS_TRANSCRIPT),
    })
}

/// Word bomb (10.4): a shown word counts when its stem is said in a segment
/// that starts no earlier than a second before it appeared.
fn word_bomb(i: &ResultInputs) -> Value {
    let words = param_list(i.params, "words");
    let mut shown_at: Vec<Option<u64>> = vec![None; words.len()];
    for m in marks(i, "word_shown") {
        if let Some(index) = m.data.get("index").and_then(Value::as_u64).and_then(|n| usize::try_from(n).ok()) {
            if index < shown_at.len() && shown_at[index].is_none() {
                shown_at[index] = Some(m.at_ms);
            }
        }
    }
    let shown = shown_at.iter().filter(|s| s.is_some()).count();
    let Some(segments) = i.segments.as_ref() else {
        return json!({ "kind": "word_bomb", "shown": shown, "woven": Value::Null, "spokenAtMs": Value::Null, "unavailableReason": NEEDS_TRANSCRIPT });
    };
    if shown > 0 && segments.iter().any(|s| s.start_ms.is_none()) {
        return json!({ "kind": "word_bomb", "shown": shown, "woven": Value::Null, "spokenAtMs": Value::Null, "unavailableReason": "Needs a transcript with timing." });
    }
    let said = stemmed_words(segments);
    let spoken: Vec<i64> = words
        .iter()
        .zip(&shown_at)
        .map(|(forms, at)| {
            let Some(at) = at else { return -1 };
            let stems = form_stems(forms);
            said.iter()
                .find(|(stem, start)| start.is_some_and(|s| s + BOMB_EARLY_MS >= *at) && stems.contains(stem))
                .and_then(|(_, start)| start.and_then(|s| i64::try_from(s).ok()))
                .unwrap_or(-1)
        })
        .collect();
    json!({ "kind": "word_bomb", "shown": shown, "woven": spoken.iter().filter(|s| **s >= 0).count(), "spokenAtMs": spoken, "unavailableReason": Value::Null })
}

/// Emphasis game (10.6): the strongest beat of the take against this round's target word.
fn emphasis(i: &ResultInputs) -> Value {
    let round = i.step_index.unwrap_or(0) as usize;
    let target = param_list(i.params, "targets").get(round).and_then(|t| t.parse::<u64>().ok());
    let Some(p) = i.prominence.as_ref() else {
        return json!({ "kind": "emphasis", "round": round, "target": target, "peakWord": Value::Null, "hit": Value::Null, "aligned": false, "nuclei": 0, "expected": 0, "unavailableReason": "The take's audio is unavailable." });
    };
    let peak = if p.aligned { p.peak_word } else { None };
    json!({
        "kind": "emphasis", "round": round, "target": target, "peakWord": peak,
        "hit": peak.zip(target).map(|(w, t)| w as u64 == t),
        "aligned": p.aligned, "nuclei": p.nuclei.len(), "expected": p.expected_syllables,
        "unavailableReason": p.unavailable_reason.clone().or_else(|| (!p.aligned).then(|| "Couldn't line up the beats this time.".to_string())),
    })
}

/// Pace ladder (10.7): this round's rate from the audio; the ladder compares the three.
fn pace_ladder(i: &ResultInputs) -> Value {
    json!({ "kind": "pace_ladder", "rateSps": i.rate_sps, "unavailableReason": if i.rate_sps.is_none() { i.rate_reason.clone() } else { None } })
}

/// Story cubes (10.8): icons whose synonyms you said, each counted once.
fn story_cubes(i: &ResultInputs) -> Value {
    let icons = param_list(i.params, "icons");
    let Some(segments) = i.segments.as_ref() else {
        return json!({ "kind": "story_cubes", "icons": icons.len(), "used": Value::Null, "usedIcons": Value::Null, "unavailableReason": NEEDS_TRANSCRIPT });
    };
    let said: Vec<String> = stemmed_words(segments).into_iter().map(|(s, _)| s).collect();
    let used: Vec<u8> = icons.iter().map(|forms| u8::from(form_stems(forms).iter().any(|s| said.contains(s)))).collect();
    json!({ "kind": "story_cubes", "icons": icons.len(), "used": used.iter().filter(|u| **u == 1).count(), "usedIcons": used, "unavailableReason": Value::Null })
}

/// Story spine (10.8): the cards you reached, from the marks.
fn story_spine(i: &ResultInputs) -> Value {
    let advanced = marks(i, "card_advanced").count() as u64;
    json!({ "kind": "story_spine", "steps": (advanced + 1).min(SPINE_STEPS), "advanced": advanced, "words": i.measures.as_ref().map(|m| m.word_count) })
}

/// Daily prompt (10.11): six 10-second windows. 0 flowing, 1 hesitation (a
/// candidate's segment starts in it), 2 pause (a long pause overlaps it), 3 silent.
/// A window with a hesitation and a pause shows the hesitation.
fn daily_grid(i: &ResultInputs) -> Value {
    let voice = usable_voice(i);
    let transcribed = i.measures.is_some();
    if voice.is_none() && !transcribed {
        return json!({ "kind": "daily", "windows": Value::Null, "flowing": Value::Null, "hesitation": Value::Null, "pause": Value::Null, "silent": Value::Null, "transcribed": false, "unavailableReason": "No clear speech was found in the recording." });
    }
    let (start, end) = speech_bounds(i);
    let all_pauses: Vec<Pause> = voice.map(|v| v.pauses.clone()).unwrap_or_else(|| i.measures.as_ref().map(|m| m.pauses.clone()).unwrap_or_default());
    let long = long_pauses(i);
    let hesitations: Vec<u64> = i.measures.as_ref().map(|m| m.fillers.iter().filter_map(|f| f.segment_start_ms).collect()).unwrap_or_default();
    let overlap = |a: u64, b: u64, c: u64, d: u64| a.max(c) < b.min(d);
    let windows: Vec<u8> = (0..DAILY_WINDOWS)
        .map(|w| {
            let (from, to) = (w * DAILY_WINDOW_MS, (w + 1) * DAILY_WINDOW_MS);
            let spoken = to.min(end).saturating_sub(from.max(start));
            let paused: u64 = all_pauses.iter().map(|p| (to.min(p.start_ms + p.duration_ms)).saturating_sub(from.max(p.start_ms))).sum();
            if from >= i.duration_ms || spoken.saturating_sub(paused) < MIN_SPEECH_IN_WINDOW_MS {
                3
            } else if hesitations.iter().any(|&h| h >= from && h < to) {
                1
            } else if long.iter().any(|p| overlap(from, to, p.start_ms, p.start_ms + p.duration_ms)) {
                2
            } else {
                0
            }
        })
        .collect();
    let count = |code: u8| windows.iter().filter(|w| **w == code).count();
    json!({
        "kind": "daily", "windows": windows, "flowing": count(0), "hesitation": count(1), "pause": count(2), "silent": count(3),
        "transcribed": transcribed,
        "unavailableReason": if transcribed { Value::Null } else { json!("Hesitations need a transcript; pauses and silence come from the audio.") },
    })
}

/// Every other drill: how long you spoke and, with a transcript, your words.
fn basic(i: &ResultInputs) -> Value {
    let m = i.measures.as_ref();
    json!({
        "kind": "basic", "durationMs": i.duration_ms, "words": m.map(|m| m.word_count), "speechMs": m.and_then(|m| m.speech_span_ms),
        "hesitations": m.map(|m| m.fillers.len()), "differentPer50": m.and_then(|m| m.different_per_50),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::{measure, SegmentInput};

    fn pause(start_ms: u64, duration_ms: u64) -> Pause {
        Pause { after_segment: 0, start_ms, duration_ms }
    }

    fn voice(start: u64, end: u64, pauses: Vec<Pause>) -> VoiceActivity {
        VoiceActivity { method: "peak-energy-v1", source: "Estimated", speech_start_ms: Some(start), speech_end_ms: Some(end), pauses, unavailable_reason: None }
    }

    fn mark(at_ms: u64, kind: &str, data: Value) -> Mark {
        Mark { at_ms, kind: kind.into(), data: data.as_object().cloned().unwrap_or_default() }
    }

    fn inputs<'a>(kind: &'a str, params: &'a Map<String, Value>) -> ResultInputs<'a> {
        ResultInputs { kind, params, step_index: None, duration_ms: 62_000, segments: None, measures: None, voice: None, rate_sps: None, rate_reason: None, marks: Vec::new(), prominence: None }
    }

    fn transcript(parts: &[(&str, u64, u64)]) -> (Vec<Segment>, Measures) {
        let inputs: Vec<SegmentInput> = parts.iter().map(|(text, s, e)| SegmentInput { text, start_ms: Some(*s), end_ms: Some(*e) }).collect();
        (parts.iter().map(|(text, s, e)| Segment { text: (*text).into(), start_ms: Some(*s), end_ms: Some(*e) }).collect(), measure(&inputs))
    }

    #[test]
    fn jam_clean_seconds_subtracts_each_penalty_once() {
        let params = Map::new();
        let (segments, measures) = transcript(&[("So um the best meal I ever had", 500, 9_000), ("was a a soup in Lisbon uh", 10_000, 30_000), ("and it was er warm and the the bread was fresh", 31_000, 61_000)]);
        assert_eq!((measures.fillers.len(), measures.repeated_words.len()), (3, 2));
        let mut i = inputs("jam", &params);
        i.segments = Some(segments);
        i.measures = Some(measures);
        // Spoke from 0.5 s to 61 s: capped at 60 s. One long pause of 2.1 s, one short one, one flag.
        i.voice = Some(voice(500, 61_000, vec![pause(20_000, 2_100), pause(40_000, 900)]));
        i.marks = vec![mark(12_000, "self_flag", json!({}))];
        let r = jam(&i);
        // 60 − 3 × 1 − 2.1 − 2 × 0.5 − 1 = 52.9 → 52.
        assert_eq!(r["cleanSeconds"], 52);
        assert_eq!((r["hesitations"].as_u64(), r["longPauses"].as_u64(), r["longPauseMs"].as_u64(), r["repeats"].as_u64(), r["flags"].as_u64()), (Some(3), Some(1), Some(2_100), Some(2), Some(1)));
        assert_eq!(r["speakingMs"], 60_000);
    }

    #[test]
    fn jam_without_transcript_reports_pauses_and_flags_only() {
        let params = Map::new();
        let mut i = inputs("jam", &params);
        i.voice = Some(voice(0, 58_000, vec![pause(10_000, 1_600), pause(30_000, 3_000)]));
        i.marks = vec![mark(5_000, "self_flag", json!({})), mark(6_000, "self_flag", json!({}))];
        let r = jam(&i);
        assert!(r["cleanSeconds"].is_null() && r["hesitations"].is_null() && r["repeats"].is_null());
        assert_eq!((r["longPauses"].as_u64(), r["longPauseMs"].as_u64(), r["flags"].as_u64()), (Some(2), Some(4_600), Some(2)));
        assert_eq!(r["unavailableReason"], "Needs a transcript.");
    }

    #[test]
    fn jam_caps_speaking_time_at_sixty_seconds() {
        let params = Map::new();
        let (segments, measures) = transcript(&[("A long and steady answer with no slips at all", 0, 80_000)]);
        let mut i = inputs("jam", &params);
        i.duration_ms = 81_000;
        i.segments = Some(segments);
        i.measures = Some(measures);
        // A pause after the minute costs nothing.
        i.voice = Some(voice(0, 80_000, vec![pause(70_000, 4_000)]));
        assert_eq!(jam(&i)["cleanSeconds"], 60);
    }

    #[test]
    fn word_bomb_counts_a_word_only_after_it_was_shown() {
        let params: Map<String, Value> = json!({"words": ["umbrella|umbrellas", "ladder|ladders", "candle|candles"]}).as_object().cloned().unwrap();
        let (segments, measures) = transcript(&[("I took my umbrella to work", 0, 10_000), ("then I climbed a ladder", 19_500, 25_000), ("and later the umbrella broke", 40_000, 45_000)]);
        let mut i = inputs("word_bomb", &params);
        i.segments = Some(segments);
        i.measures = Some(measures);
        i.marks = vec![mark(30_000, "word_shown", json!({"index": 0})), mark(20_000, "word_shown", json!({"index": 1})), mark(50_000, "word_shown", json!({"index": 2}))];
        let r = word_bomb(&i);
        // The umbrella said before it was shown doesn't count; the one after does. The ladder counts from a second early.
        assert_eq!(r["spokenAtMs"], json!([40_000, 19_500, -1]));
        assert_eq!((r["shown"].as_u64(), r["woven"].as_u64()), (Some(3), Some(2)));
    }

    #[test]
    fn word_bomb_matches_plurals_and_tense() {
        let params: Map<String, Value> = json!({"words": ["box|boxes", "passport|passports"]}).as_object().cloned().unwrap();
        let (segments, measures) = transcript(&[("we packed three boxes and both passports", 16_000, 22_000)]);
        let mut i = inputs("word_bomb", &params);
        i.segments = Some(segments);
        i.measures = Some(measures);
        i.marks = vec![mark(15_000, "word_shown", json!({"index": 0})), mark(15_500, "word_shown", json!({"index": 1}))];
        assert_eq!(word_bomb(&i)["woven"], 2);
        i.segments = None;
        assert!(word_bomb(&i)["woven"].is_null(), "no transcript, no estimate");
    }

    #[test]
    fn story_cubes_match_synonyms_once_per_icon() {
        let params: Map<String, Value> = json!({"icons": ["key|keys|lock|unlock", "moon|night", "dog|puppy", "train|station|platform"]}).as_object().cloned().unwrap();
        let (segments, _) = transcript(&[("At night I lost my keys, and the lock was stuck", 0, 9_000), ("so the puppy and I walked to the station, keys forgotten", 10_000, 20_000)]);
        let mut i = inputs("story_cubes", &params);
        i.segments = Some(segments);
        let r = story_cubes(&i);
        assert_eq!(r["usedIcons"], json!([1, 1, 1, 1]));
        assert_eq!((r["used"].as_u64(), r["icons"].as_u64()), (Some(4), Some(4)));
        let (segments, _) = transcript(&[("A key and another key and a third key", 0, 5_000)]);
        i.segments = Some(segments);
        assert_eq!(story_cubes(&i)["used"], 1, "each icon counts once");
    }

    #[test]
    fn daily_grid_classifies_windows() {
        let params = Map::new();
        let (segments, measures) = transcript(&[("I remember the smell of bread", 0, 8_000), ("um my grandmother baked it", 21_000, 28_000), ("every sunday morning", 30_000, 40_000)]);
        let mut i = inputs("daily", &params);
        i.duration_ms = 60_000;
        i.segments = Some(segments);
        i.measures = Some(measures);
        // Speech until 47 s, a long pause from 33 to 35 s.
        i.voice = Some(voice(0, 47_000, vec![pause(33_000, 2_000)]));
        let r = daily_grid(&i);
        assert_eq!(r["windows"], json!([0, 0, 1, 2, 0, 3]));
        assert_eq!((r["flowing"].as_u64(), r["hesitation"].as_u64(), r["pause"].as_u64(), r["silent"].as_u64()), (Some(3), Some(1), Some(1), Some(1)));
        // Without a transcript only pauses and silence are found.
        i.measures = None;
        let r = daily_grid(&i);
        assert_eq!(r["windows"], json!([0, 0, 0, 2, 0, 3]));
        assert_eq!(r["transcribed"], false);
    }

    #[test]
    fn story_spine_counts_cards_and_pace_ladder_reports_its_rate() {
        let params = Map::new();
        let mut i = inputs("story_spine", &params);
        i.marks = (0..9).map(|k| mark(k * 10_000, "card_advanced", json!({}))).collect();
        assert_eq!(story_spine(&i)["steps"], 7, "at most seven cards");
        let mut i = inputs("pace_ladder", &params);
        i.rate_reason = Some("Needs at least 5 seconds of speech.".into());
        assert_eq!(pace_ladder(&i)["unavailableReason"], "Needs at least 5 seconds of speech.");
        i.rate_sps = Some(4.2);
        assert_eq!(numbers(&pace_ladder(&i)).get("rateSps"), Some(&4.2));
    }
}
