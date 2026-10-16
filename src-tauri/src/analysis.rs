//! Review measures derived from a saved transcript (plan 3.6, 3.7; roadmap 8.1).
//! Everything here is Estimated: it relies on the model's text and segment
//! times, not on voice activity detection. Filler hits are review candidates,
//! never verdicts. Missing values are `None` with a reason, never 0.
use serde::Serialize;
use std::collections::HashMap;

/// Measures definition. Version 2 (8.1) adds runs, pause location, words you
/// use often, hedges, vocabulary range, opener and ending; v1 runs stay stored.
pub const DEFINITION_VERSION: u32 = 2;
/// Version of the filler candidate list. Your hesitation decisions are stored
/// with it, so they survive a new measures version that keeps the list.
pub const FILLER_DEFINITION_VERSION: u32 = 1;
/// Pause threshold from §11; stored with the result so it can change later.
pub const PAUSE_THRESHOLD_MS: u64 = 700;
const PACE_MIN_SPAN_MS: u64 = 15_000;
const PACE_MIN_WORDS: usize = 20;
/// Unambiguous hesitation sounds. "Like" and "you know" are left to the user (D-16).
const FILLERS: [&str; 8] = ["uh", "um", "uhm", "umm", "uhh", "er", "erm", "ah"];
const MIN_WORDS: usize = 20;
/// Moving window for vocabulary range (MATTR, Covington & McFall 2010).
pub const VOCABULARY_WINDOW: usize = 50;
const EDGE_MAX_CHARS: usize = 200;
/// A pause before one of these words falls between clauses (Tavakoli 2011).
const CLAUSE_STARTERS: [&str; 16] = ["and", "but", "so", "because", "which", "who", "when", "if", "then", "although", "while", "after", "before", "that", "or", "where"];
/// Words you use often, default list "default-v1". "Like" is left out (D-16).
pub const WATCH_WORDS: [&str; 11] = ["basically", "actually", "literally", "honestly", "obviously", "you know", "i mean", "so yeah", "or something", "and stuff", "and so on"];
pub const HEDGES: [&str; 13] = ["maybe", "perhaps", "probably", "possibly", "i think", "i guess", "i suppose", "kind of", "sort of", "a bit", "a little bit", "somewhat", "i'm not sure"];
/// Endings that trail off rather than finish ("so yeah" and "and yeah" end in "yeah").
const TRAILING: [&str; 5] = ["yeah", "that's it", "or something", "and stuff", "i guess"];

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

/// Speech between pauses: consecutive timed segments less than the pause
/// threshold apart (mean length of run, Kormos & Dénes 2004).
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Runs {
    pub mean_words: f64,
    pub longest_words: u32,
    pub longest_from_segment: usize,
    pub longest_to_segment: usize,
    pub count: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WordCount {
    pub word: String,
    pub count: u32,
    pub segments: Vec<usize>,
}

/// The opening or ending sentence, quoted for your self-check (8.3).
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Edge {
    pub text: String,
    pub segment: usize,
    pub hint: Option<&'static str>,
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
    pub runs: Option<Runs>,
    pub runs_unavailable_reason: Option<String>,
    /// Parallel to `pauses`: "boundary" (between clauses) or "mid_clause".
    pub pause_kinds: Vec<&'static str>,
    pub watch_words: Vec<WordCount>,
    pub hedges: Vec<WordCount>,
    pub words_unavailable_reason: Option<String>,
    pub different_per_50: Option<f64>,
    pub vocabulary_unavailable_reason: Option<String>,
    pub opener: Option<Edge>,
    pub ending: Option<Edge>,
}

/// Lowercase word without surrounding punctuation ("Uh," → "uh").
pub fn normalize(word: &str) -> String {
    word.trim_matches(|c: char| !c.is_alphanumeric() && c != '\'').to_lowercase()
}

pub fn is_filler(word: &str) -> bool {
    FILLERS.contains(&normalize(word).as_str())
}

/// Normalized words of a text: lowercase, outer punctuation and quotes removed,
/// curly apostrophes made straight, so "I’m" and "I'm," are both "i'm".
pub fn tokens(text: &str) -> Vec<String> {
    text.split_whitespace()
        .map(|w| w.replace('\u{2019}', "'").trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase())
        .filter(|w| !w.is_empty())
        .collect()
}

/// Counts each item (one or more words) as a whole-token sequence. At each
/// position the longest item wins and its tokens are used up, so nothing is
/// counted twice and "I mean" never matches "I meant". Most frequent first.
pub fn count_sequences(tokens: &[String], items: &[&str]) -> Vec<WordCount> {
    count_sequences_in(&tokens.iter().map(|t| (t.clone(), 0)).collect::<Vec<_>>(), items)
}

fn count_sequences_in(tokens: &[(String, usize)], items: &[&str]) -> Vec<WordCount> {
    let mut parsed: Vec<(usize, Vec<&str>)> = items.iter().enumerate().map(|(i, item)| (i, item.split_whitespace().collect())).collect();
    parsed.retain(|(_, words)| !words.is_empty());
    parsed.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));
    let mut counts: HashMap<usize, (u32, Vec<usize>)> = HashMap::new();
    let mut i = 0;
    while i < tokens.len() {
        let found = parsed.iter().find(|(_, words)| i + words.len() <= tokens.len() && words.iter().zip(&tokens[i..]).all(|(w, (t, _))| w == t));
        match found {
            Some((index, words)) => {
                let entry = counts.entry(*index).or_default();
                entry.0 += 1;
                if !entry.1.contains(&tokens[i].1) {
                    entry.1.push(tokens[i].1);
                }
                i += words.len();
            }
            None => i += 1,
        }
    }
    let mut out: Vec<(usize, WordCount)> = counts.into_iter().map(|(index, (count, segments))| (index, WordCount { word: items[index].to_string(), count, segments })).collect();
    out.sort_by(|a, b| b.1.count.cmp(&a.1.count).then(a.0.cmp(&b.0)));
    out.into_iter().map(|(_, c)| c).collect()
}

/// Mean number of different words in every window of `window` words (moving
/// window, step 1). `None` when there are fewer words than one window.
pub fn different_per_window(tokens: &[String], window: usize) -> Option<f64> {
    if window == 0 || tokens.len() < window {
        return None;
    }
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for t in &tokens[..window] {
        *counts.entry(t).or_default() += 1;
    }
    let mut total = counts.len() as u64;
    for i in window..tokens.len() {
        let out = tokens[i - window].as_str();
        if let Some(n) = counts.get_mut(out) {
            *n -= 1;
            if *n == 0 {
                counts.remove(out);
            }
        }
        *counts.entry(tokens[i].as_str()).or_default() += 1;
        total += counts.len() as u64;
    }
    let windows = (tokens.len() - window + 1) as f64;
    Some((total as f64 / windows * 10.0).round() / 10.0)
}

const TERMINATORS: [char; 4] = ['.', '?', '!', '\u{2026}'];

fn clip_start(text: &str) -> String {
    if text.chars().count() <= EDGE_MAX_CHARS {
        return text.to_string();
    }
    let cut: String = text.chars().take(EDGE_MAX_CHARS).collect();
    let cut = cut.rsplit_once(' ').map_or(cut.as_str(), |(head, _)| head).trim_end().to_string();
    format!("{cut}\u{2026}")
}

fn clip_end(text: &str) -> String {
    let count = text.chars().count();
    if count <= EDGE_MAX_CHARS {
        return text.to_string();
    }
    let cut: String = text.chars().skip(count - EDGE_MAX_CHARS).collect();
    let cut = cut.split_once(' ').map_or(cut.as_str(), |(_, tail)| tail).trim_start().to_string();
    format!("\u{2026}{cut}")
}

/// Text up to and including the first `. ? !` (at most 200 characters).
pub fn first_sentence(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let end = text.char_indices().find(|(_, c)| TERMINATORS.contains(c)).map_or(text.len(), |(i, c)| i + c.len_utf8());
    Some(clip_start(text[..end].trim()))
}

/// Byte offset where the last sentence starts.
fn last_sentence_start(text: &str) -> usize {
    let body = text.trim_end_matches(|c: char| TERMINATORS.contains(&c) || c.is_whitespace());
    body.char_indices().rev().find(|(_, c)| TERMINATORS.contains(c)).map_or(0, |(i, c)| i + c.len_utf8())
}

/// The last sentence (at most its last 200 characters).
pub fn last_sentence(text: &str) -> Option<String> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    Some(clip_end(text[last_sentence_start(text)..].trim()))
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

    let pause_kinds = pause_kinds(segments, &pauses);
    let (runs, runs_reason) = runs(segments);
    let word_tokens: Vec<(String, usize)> = segments
        .iter()
        .enumerate()
        .flat_map(|(index, s)| tokens(s.text).into_iter().map(move |t| (t, index)))
        .collect();
    let (watch_words, hedges, words_reason) = if words < MIN_WORDS {
        (Vec::new(), Vec::new(), Some("Needs at least 20 words.".to_string()))
    } else {
        (count_sequences_in(&word_tokens, &WATCH_WORDS), count_sequences_in(&word_tokens, &HEDGES), None)
    };
    let vocabulary: Vec<String> = word_tokens.iter().filter(|(t, _)| !FILLERS.contains(&t.as_str())).map(|(t, _)| t.clone()).collect();
    let different = different_per_window(&vocabulary, VOCABULARY_WINDOW);
    let (opener, ending) = edges(segments);

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
        runs,
        runs_unavailable_reason: runs_reason,
        pause_kinds,
        watch_words,
        hedges,
        words_unavailable_reason: words_reason,
        vocabulary_unavailable_reason: different.is_none().then(|| "Needs at least 50 words.".to_string()),
        different_per_50: different,
        opener,
        ending,
    }
}

fn spoken_words(text: &str) -> Vec<String> {
    tokens(text).into_iter().filter(|t| !FILLERS.contains(&t.as_str())).collect()
}

/// Runs of speech: neighbouring timed segments closer than the pause threshold.
/// An untimed segment ends a run; a segment of hesitations alone adds no words.
fn runs(segments: &[SegmentInput]) -> (Option<Runs>, Option<String>) {
    let mut runs: Vec<(u32, usize, usize)> = Vec::new();
    let mut current: Option<(u32, usize, usize, u64)> = None;
    let mut any_timed = false;
    for (index, segment) in segments.iter().enumerate() {
        if segment.text.trim().is_empty() {
            continue;
        }
        let (Some(start), Some(end)) = (segment.start_ms, segment.end_ms) else {
            runs.extend(current.take().map(|(w, from, to, _)| (w, from, to)));
            continue;
        };
        any_timed = true;
        let words = spoken_words(segment.text).len() as u32;
        current = match current {
            Some((w, from, _, last_end)) if start.saturating_sub(last_end) < PAUSE_THRESHOLD_MS => Some((w + words, from, index, end)),
            previous => {
                runs.extend(previous.map(|(w, from, to, _)| (w, from, to)));
                Some((words, index, index, end))
            }
        };
    }
    runs.extend(current.map(|(w, from, to, _)| (w, from, to)));
    if !any_timed {
        return (None, Some("Segment timings are unavailable.".into()));
    }
    runs.retain(|(w, _, _)| *w > 0);
    let total: u32 = runs.iter().map(|(w, _, _)| w).sum();
    if (total as usize) < MIN_WORDS {
        return (None, Some("Needs at least 20 words.".into()));
    }
    // The first of equally long runs is the one quoted.
    let longest = runs.iter().fold(runs[0], |best, r| if r.0 > best.0 { *r } else { best });
    let mean = (f64::from(total) / runs.len() as f64 * 10.0).round() / 10.0;
    (Some(Runs { mean_words: mean, longest_words: longest.0, longest_from_segment: longest.1, longest_to_segment: longest.2, count: runs.len() as u32 }), None)
}

/// Where each pause fell: between clauses when the segment before it ends with
/// punctuation or the next one starts with a clause starter, otherwise inside one.
fn pause_kinds(segments: &[SegmentInput], pauses: &[Pause]) -> Vec<&'static str> {
    pauses
        .iter()
        .map(|p| {
            let before = segments.get(p.after_segment).map_or("", |s| s.text.trim_end());
            let ends_clause = before.ends_with(['.', '?', '!', ';', ':', ',', '\u{2026}']);
            let next = segments.get(p.after_segment + 1).map(|s| spoken_words(s.text)).unwrap_or_default();
            let starts_clause = next.first().is_some_and(|w| CLAUSE_STARTERS.contains(&w.as_str()));
            if ends_clause || starts_clause { "boundary" } else { "mid_clause" }
        })
        .collect()
}

/// Opening and ending sentences of the whole transcript, with the segment each
/// starts in and a hint for a hesitant start or an ending that trails off.
fn edges(segments: &[SegmentInput]) -> (Option<Edge>, Option<Edge>) {
    let mut text = String::new();
    let mut starts: Vec<(usize, usize)> = Vec::new();
    for (index, segment) in segments.iter().enumerate() {
        let part = segment.text.trim();
        if part.is_empty() {
            continue;
        }
        if !text.is_empty() {
            text.push(' ');
        }
        starts.push((text.len(), index));
        text.push_str(part);
    }
    let Some(opening) = first_sentence(&text) else {
        return (None, None);
    };
    let segment_at = |offset: usize| starts.iter().rev().find(|(start, _)| *start <= offset).map_or(0, |(_, i)| *i);
    let first = tokens(&text);
    let filler = |t: Option<&String>| t.is_some_and(|t| FILLERS.contains(&t.as_str()));
    let hesitant = filler(first.first()) || (first.first().map(String::as_str) == Some("so") && filler(first.get(1)));
    let opener = Edge { text: opening, segment: starts[0].1, hint: hesitant.then_some("starts_with_hesitation") };
    // The ending is quoted from where the last sentence starts, after leading spaces.
    let offset = last_sentence_start(&text);
    let offset = offset + text[offset..].len() - text[offset..].trim_start().len();
    let closing = last_sentence(&text).unwrap_or_default();
    let last = tokens(&closing);
    let trails = TRAILING.iter().any(|item| {
        let words: Vec<&str> = item.split_whitespace().collect();
        last.len() >= words.len() && last[last.len() - words.len()..].iter().zip(&words).all(|(t, w)| t == w)
    });
    let ending = Edge { text: closing, segment: segment_at(offset), hint: trails.then_some("trails_off") };
    (Some(opener), Some(ending))
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

/// Common irregular forms mapped to the base form for phrase matching (8.2).
const IRREGULAR: [(&str, &str); 66] = [
    ("lost", "lose"), ("took", "take"), ("taken", "take"), ("made", "make"), ("went", "go"), ("gone", "go"), ("goes", "go"),
    ("said", "say"), ("says", "say"), ("thought", "think"), ("felt", "feel"), ("got", "get"), ("gotten", "get"), ("gave", "give"),
    ("given", "give"), ("came", "come"), ("knew", "know"), ("known", "know"), ("found", "find"), ("left", "leave"), ("kept", "keep"),
    ("began", "begin"), ("begun", "begin"), ("brought", "bring"), ("stood", "stand"), ("told", "tell"), ("spoke", "speak"),
    ("spoken", "speak"), ("wrote", "write"), ("written", "write"), ("did", "do"), ("done", "do"), ("does", "do"), ("had", "have"),
    ("has", "have"), ("was", "be"), ("were", "be"), ("been", "be"), ("is", "be"), ("are", "be"), ("am", "be"), ("saw", "see"),
    ("seen", "see"), ("ran", "run"), ("held", "hold"), ("met", "meet"), ("paid", "pay"), ("put", "put"), ("set", "set"),
    ("sent", "send"), ("spent", "spend"), ("built", "build"), ("bought", "buy"), ("caught", "catch"), ("taught", "teach"),
    ("fought", "fight"), ("sought", "seek"), ("chose", "choose"), ("chosen", "choose"), ("broke", "break"), ("broken", "break"),
    ("fell", "fall"), ("fallen", "fall"), ("drew", "draw"), ("drawn", "draw"), ("meant", "mean"),
];
/// Stand-ins in a saved expression that match one to four of your words.
const PLACEHOLDERS: [&str; 8] = ["something", "someone", "somebody", "sth", "sb", "x", "one's", "someone's"];
const ARTICLES: [&str; 3] = ["a", "an", "the"];

/// A rough stem so tense and plural forms meet: possessive 's, an irregular
/// form, then one ending (`ing`, `ed`, `es`, `s`) on words longer than four
/// letters, a doubled final consonant, a final "e" and "y" → "i".
pub fn stem(token: &str) -> String {
    let token = token.strip_suffix("'s").unwrap_or(token);
    let mut word = IRREGULAR.iter().find(|(form, _)| *form == token).map_or(token, |(_, base)| *base).to_string();
    if word.chars().count() > 4 && !word.ends_with("ss") {
        if let Some(cut) = ["ing", "ed", "es", "s"].iter().find_map(|end| word.strip_suffix(end)) {
            let stripped_s = word.ends_with('s') && !word.ends_with("es");
            word = cut.to_string();
            // "stopped" → "stopp" → "stop", but "falling" keeps "fall" and "guesses" keeps "guess".
            let bytes = word.as_bytes();
            let n = bytes.len();
            if !stripped_s && n >= 3 && bytes[n - 1] == bytes[n - 2] && !matches!(bytes[n - 1], b'l' | b's' | b'e' | b'o') && bytes[n - 1].is_ascii_alphabetic() {
                word.pop();
            }
        }
    }
    if word.chars().count() > 3 && word.ends_with('e') {
        word.pop();
    }
    if word.chars().count() > 2 && word.ends_with('y') {
        word.pop();
        word.push('i');
    }
    word
}

enum Part {
    Word(String),
    Placeholder,
}

/// A saved expression ready to be found in many transcripts (8.2).
pub struct PhrasePattern {
    parts: Vec<Part>,
}

/// Your words without articles, stemmed, each with its index in `tokens`.
pub fn stemmed(tokens: &[String]) -> Vec<(usize, String)> {
    tokens.iter().enumerate().filter(|(_, t)| !ARTICLES.contains(&t.as_str())).map(|(i, t)| (i, stem(t))).collect()
}

impl PhrasePattern {
    /// `None` for expressions with fewer than two words of their own, so a
    /// single word like "nice" never matches.
    pub fn new(expression: &str) -> Option<Self> {
        let mut parts: Vec<Part> = tokens(expression)
            .into_iter()
            .filter(|t| !ARTICLES.contains(&t.as_str()))
            .map(|t| if PLACEHOLDERS.contains(&t.as_str()) { Part::Placeholder } else { Part::Word(stem(&t)) })
            .collect();
        // A stand-in at either end adds nothing to find.
        while matches!(parts.first(), Some(Part::Placeholder)) {
            parts.remove(0);
        }
        while matches!(parts.last(), Some(Part::Placeholder)) {
            parts.pop();
        }
        (parts.iter().filter(|p| matches!(p, Part::Word(_))).count() >= 2).then_some(Self { parts })
    }

    /// First and last matched token (indices into the original tokens).
    pub fn find(&self, words: &[(usize, String)]) -> Option<(usize, usize)> {
        // Index into `words` where part `i` must start; returns the last matched index.
        fn from(parts: &[Part], words: &[(usize, String)], i: usize, at: usize) -> Option<usize> {
            let Part::Word(word) = &parts[i] else { return None };
            if words.get(at).map(|(_, w)| w) != Some(word) {
                return None;
            }
            if i + 1 == parts.len() {
                return Some(at);
            }
            match &parts[i + 1] {
                Part::Word(_) => [at + 1, at + 2].into_iter().find_map(|next| from(parts, words, i + 1, next)),
                Part::Placeholder => (1..=4).find_map(|span| from(parts, words, i + 2, at + 1 + span)),
            }
        }
        (0..words.len()).find_map(|start| from(&self.parts, words, 0, start).map(|end| (words[start].0, words[end].0)))
    }
}

/// Finds a saved expression in your words (8.2, Estimated). Articles are
/// ignored, words are compared by `stem`, placeholders match one to four
/// words, and at most one extra word may sit between two expression words.
/// Returns the first and last matched token (indices into `tokens`).
/// Expressions with fewer than two words of their own never match.
pub fn phrase_match(expression: &str, tokens: &[String]) -> Option<(usize, usize)> {
    PhrasePattern::new(expression)?.find(&stemmed(tokens))
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

    const TEN: &str = "one two three four five six seven eight nine ten";

    #[test]
    fn runs_join_segments_closer_than_the_threshold() {
        let m = measure(&[seg(TEN, 0, 3_000), seg(TEN, 3_500, 6_000), seg("Uh, um.", 6_100, 6_500), seg(TEN, 8_000, 11_000)]);
        let runs = m.runs.expect("30 timed words");
        assert_eq!((runs.count, runs.longest_words, runs.longest_from_segment, runs.longest_to_segment), (2, 20, 0, 2));
        assert_eq!(runs.mean_words, 15.0, "hesitations alone add no words");
        assert!(m.runs_unavailable_reason.is_none());
    }

    #[test]
    fn untimed_segment_ends_a_run() {
        let untimed = SegmentInput { text: TEN, start_ms: None, end_ms: None };
        let m = measure(&[seg(TEN, 0, 3_000), untimed, seg(TEN, 3_100, 6_000), seg(TEN, 6_200, 9_000)]);
        let runs = m.runs.unwrap();
        assert_eq!((runs.count, runs.longest_words, runs.longest_from_segment, runs.longest_to_segment), (2, 20, 2, 3));
        let none = measure(&[SegmentInput { text: TEN, start_ms: None, end_ms: None }]);
        assert_eq!((none.runs, none.runs_unavailable_reason.as_deref()), (None, Some("Segment timings are unavailable.")));
    }

    #[test]
    fn runs_need_twenty_words() {
        let m = measure(&[seg(TEN, 0, 3_000), seg("eleven twelve", 5_000, 6_000)]);
        assert_eq!((m.runs, m.runs_unavailable_reason.as_deref()), (None, Some("Needs at least 20 words.")));
        assert_eq!(m.words_unavailable_reason.as_deref(), Some("Needs at least 20 words."));
        assert!(m.watch_words.is_empty() && m.hedges.is_empty());
    }

    #[test]
    fn pause_after_punctuation_or_before_a_clause_starter_is_a_boundary() {
        let m = measure(&[seg("I went home.", 0, 1_000), seg("It was late", 2_000, 3_000), seg("because the train stopped", 4_000, 5_000), seg("Uh, then we", 6_000, 7_000), seg("waited", 8_000, 9_000)]);
        assert_eq!(m.pauses.len(), 4);
        // Leading hesitations are skipped when finding the next word ("Uh, then").
        assert_eq!(m.pause_kinds, ["boundary", "boundary", "boundary", "mid_clause"]);
    }

    #[test]
    fn pause_inside_a_clause_is_mid_clause() {
        let m = measure(&[seg("I went to the", 0, 1_000), seg("store", 2_000, 2_500)]);
        assert_eq!(m.pause_kinds, ["mid_clause"]);
        let none = measure(&[SegmentInput { text: "I went to the store", start_ms: None, end_ms: None }]);
        assert!(none.pause_kinds.is_empty() && none.pauses_unavailable_reason.is_some());
    }

    #[test]
    fn multi_word_items_are_counted_as_sequences_and_not_double_counted() {
        let t = tokens("I meant it. I mean, you know, a little bit, so yeah. So yeah!");
        let watch = count_sequences(&t, &WATCH_WORDS);
        assert_eq!(watch.iter().map(|w| (w.word.as_str(), w.count)).collect::<Vec<_>>(), [("so yeah", 2), ("you know", 1), ("i mean", 1)]);
        let hedges = count_sequences(&t, &HEDGES);
        assert_eq!(hedges.iter().map(|w| (w.word.as_str(), w.count)).collect::<Vec<_>>(), [("a little bit", 1)], "a little bit is not also a bit");
        // Segments are listed once each, in order.
        let m = measure(&[seg(&format!("{TEN} actually {TEN}"), 0, 5_000), seg("actually, actually", 5_100, 6_000)]);
        assert_eq!(m.watch_words, [WordCount { word: "actually".into(), count: 3, segments: vec![0, 1] }]);
    }

    #[test]
    fn shared_word_vectors_match() {
        let vectors: serde_json::Value = serde_json::from_str(include_str!("../../src/lib/insights/fixtures/word-vectors.json")).unwrap();
        let as_map = |counts: Vec<WordCount>| counts.into_iter().map(|c| (c.word, u64::from(c.count))).collect::<std::collections::BTreeMap<_, _>>();
        let expected = |v: &serde_json::Value| v.as_object().unwrap().iter().map(|(k, n)| (k.clone(), n.as_u64().unwrap())).collect::<std::collections::BTreeMap<_, _>>();
        let mut checked = 0;
        for case in vectors["cases"].as_array().unwrap() {
            if !case["extra"].as_array().unwrap().is_empty() {
                continue; // your own words are counted in TypeScript only
            }
            let t = tokens(case["text"].as_str().unwrap());
            assert_eq!(as_map(count_sequences(&t, &WATCH_WORDS)), expected(&case["watchWords"]), "{}", case["name"]);
            assert_eq!(as_map(count_sequences(&t, &HEDGES)), expected(&case["hedges"]), "{}", case["name"]);
            checked += 1;
        }
        assert!(checked >= 4);
    }

    #[test]
    fn different_words_per_50_needs_fifty_words_and_excludes_fillers() {
        let forty_nine: Vec<String> = (0..49).map(|i| format!("w{i}")).collect();
        assert_eq!(different_per_window(&forty_nine, 50), None);
        let mut fifty = forty_nine.clone();
        fifty.push("w0".into());
        assert_eq!(different_per_window(&fifty, 50), Some(49.0));
        // 60 words cycling through 10: every window of 50 holds exactly 10 different words.
        let cycle: Vec<String> = (0..60).map(|i| format!("w{}", i % 10)).collect();
        assert_eq!(different_per_window(&cycle, 50), Some(10.0));
        let text = format!("{TEN} {TEN} {TEN} {TEN} um uh um uh um uh");
        let m = measure(&[seg(&text, 0, 20_000)]);
        assert_eq!((m.different_per_50, m.vocabulary_unavailable_reason.as_deref()), (None, Some("Needs at least 50 words.")), "hesitations are not words");
        let m = measure(&[seg(&format!("{TEN} {TEN} {TEN} {TEN} um {TEN} uh"), 0, 20_000)]);
        assert_eq!(m.different_per_50, Some(10.0));
    }

    #[test]
    fn opener_hint_flags_a_leading_filler() {
        let m = measure(&[seg("Um, so the first thing I do is plan. Then I write.", 0, 4_000)]);
        let opener = m.opener.unwrap();
        assert_eq!((opener.text.as_str(), opener.segment, opener.hint), ("Um, so the first thing I do is plan.", 0, Some("starts_with_hesitation")));
        let so_um = measure(&[seg("So, um, I plan first.", 0, 2_000)]).opener.unwrap();
        assert_eq!(so_um.hint, Some("starts_with_hesitation"));
        let clear = measure(&[seg("", 0, 10), seg("I plan first, then I write", 0, 2_000)]).opener.unwrap();
        assert_eq!((clear.text.as_str(), clear.segment, clear.hint), ("I plan first, then I write", 1, None));
        let long = "word ".repeat(80);
        assert!(first_sentence(&long).unwrap().chars().count() <= 201);
        assert_eq!(measure(&[seg("  ", 0, 10)]).opener, None);
    }

    #[test]
    fn ending_hint_flags_so_yeah() {
        let m = measure(&[seg("I plan first.", 0, 2_000), seg("Then I write it all down, so yeah.", 2_100, 5_000)]);
        let ending = m.ending.unwrap();
        assert_eq!((ending.text.as_str(), ending.segment, ending.hint), ("Then I write it all down, so yeah.", 1, Some("trails_off")));
        for trailing in ["That's it.", "We left, or something", "Pens and stuff.", "It works, I guess?"] {
            assert_eq!(measure(&[seg(trailing, 0, 1_000)]).ending.unwrap().hint, Some("trails_off"), "{trailing}");
        }
        let clear = measure(&[seg("First. So that is why planning saves me time.", 0, 3_000)]).ending.unwrap();
        assert_eq!((clear.text.as_str(), clear.hint), ("So that is why planning saves me time.", None));
        assert_eq!(last_sentence("One. Two!  "), Some("Two!".into()));
    }

    #[test]
    fn phrase_match_handles_tense_plural_articles_and_placeholders() {
        let found = |expression: &str, text: &str| phrase_match(expression, &tokens(text));
        assert_eq!(found("lose track of time", "Honestly I lost track of the time again"), Some((2, 6)));
        assert!(found("make sense", "It makes sense to me").is_some());
        assert!(found("make sense", "that made sense").is_some());
        assert!(found("take a step back", "I'm taking steps back").is_some());
        assert!(found("stop doing something", "we stopped doing the weekly report").is_some());
        assert!(found("give someone a hand", "she gave my brother a hand").is_some());
        assert!(found("give someone a hand", "she gave a hand").is_none(), "a placeholder needs at least one word");
        assert!(found("try one's best", "I tried my best").is_some());
        assert!(found("lose track of time", "I lost my keys").is_none());
        assert_eq!(stem("guesses"), stem("guess"));
        assert_eq!(stem("running"), stem("ran"));
        assert_eq!(stem("Times".to_lowercase().as_str()), stem("time"));
    }

    #[test]
    fn phrase_match_refuses_one_word_expressions() {
        assert_eq!(phrase_match("nice", &tokens("That was nice")), None);
        assert_eq!(phrase_match("the nice", &tokens("That was the nice one")), None, "articles don't count");
        assert_eq!(phrase_match("something nice", &tokens("That was something nice")), None, "nor do placeholders");
    }

    #[test]
    fn phrase_match_allows_one_extra_word_between_tokens_but_not_two() {
        let t = tokens("I lost track of all the time");
        assert_eq!(phrase_match("lose track of time", &t), Some((1, 6)), "one extra word, articles ignored");
        assert_eq!(phrase_match("lose track of time", &tokens("I lost track of nearly all time")), None);
    }
}
