# M8 — Insights and practice extras

> **Goal:** make every take tell you more, without judging it:
> - **Better fluency measures from second-language research:** runs between pauses, and whether a pause fell inside a clause.
> - **Wording measures:** the words you use often, hedges, vocabulary range, and saved phrases spotted in your speech.
> - **Self-checks:** quick yes/no notes on your opening and ending.
> - **Listening tools:** markers on the waveform, and A/B listening (blind if you like).
> - **Progress views:** trends and a speech profile.
> - **Live pace:** a live pace meter computed from the audio.
> - **Small extras:** sequence dots and Ctrl+K actions.
>
> **Visible changes:**
> - richer take summaries;
> - Progress → **Profile** tab and trend charts;
> - Compare → **A/B listen**;
> - an optional live pace meter in the recorder.
>
> **Schema:** v17. **Effort:** 12–16 days.
>
> **Exit gate:**
> - all WPs are done;
> - measures v2 are backfilled for every stored revision;
> - A-22 passes with the new values;
> - A-32 (offline) covers syllables and phrase matching;
> - Profile and Trends render with two years of seeded facts within budget.

| WP | Title | Effort |
| --- | --- | --- |
| 8.1 | Measures v2 (runs, pause location, words you use often, hedges, vocabulary, opener and ending) | L |
| 8.2 | Phrases spotted in your takes | M |
| 8.3 | Self-checks and take summary v2 | M |
| 8.4 | Waveform markers | M |
| 8.5 | A/B listen, including blind mode | M |
| 8.6 | Trends, plus Progress built from facts | M |
| 8.7 | Speech profile | M |
| 8.8 | Syllable rate and the live pace meter | L |
| 8.9 | Sequence dots | S |
| 8.10 | Ctrl+K actions | S |
| 8.11 | Settings → Words to watch | S |

**Schema v17**
```sql
-- Insights (M8). IDs and numbers only (A-30).
-- Saved phrases found in a take's current revision (8.2).
CREATE TABLE phrase_uses (
 phrase_id TEXT NOT NULL,
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 revision_id TEXT NOT NULL,
 segment INTEGER NOT NULL CHECK(segment >= 0),
 start_token INTEGER NOT NULL CHECK(start_token >= 0),
 end_token INTEGER NOT NULL CHECK(end_token >= start_token),
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(phrase_id, revision_id)
) STRICT;
CREATE INDEX phrase_uses_attempt ON phrase_uses(attempt_id);
-- Your quick yes/no notes about a take (8.3; later drills add checks). Check IDs are validated in Rust.
CREATE TABLE self_checks (
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 check_id TEXT NOT NULL,
 value INTEGER NOT NULL CHECK(value IN (0,1)),
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(attempt_id, check_id)
) STRICT;
-- Speech rate from the audio itself (8.8), computed on first request and kept.
CREATE TABLE audio_measures (
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 method TEXT NOT NULL,
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 syllables INTEGER CHECK(syllables >= 0),
 span_ms INTEGER CHECK(span_ms >= 0),
 phonation_ms INTEGER CHECK(phonation_ms >= 0),
 rate_sps REAL,
 articulation_sps REAL,
 unavailable_reason TEXT,
 created_at_ms INTEGER NOT NULL,
 CHECK((rate_sps IS NULL) <> (unavailable_reason IS NULL)),
 PRIMARY KEY(attempt_id, method, definition_version)
) STRICT;
-- A/B choices between takes of different sessions (8.5); same-session choices stay in sessions.preferred_take.
CREATE TABLE comparisons (
 id TEXT PRIMARY KEY,
 a_attempt TEXT NOT NULL,
 b_attempt TEXT NOT NULL,
 preferred TEXT NOT NULL CHECK(preferred IN ('a','b','same')),
 blind INTEGER NOT NULL CHECK(blind IN (0,1)),
 created_at_ms INTEGER NOT NULL
) STRICT;
PRAGMA user_version=17;
```
**Purge.** `purge_take_rows` deletes `phrase_uses`, `self_checks` and `audio_measures` by `attempt_id`, and deletes `comparisons` where either side is the purged take.

---

## 8.1 Measures v2

**Goal.** Add the fluency and wording measures that research finds most telling, with the same honesty as v1: Estimated, never exhaustive, missing values carry a reason.
- **Runs between pauses:** the mean length of run (Kormos & Dénes 2004).
- **Pause location:** whether a pause fell between clauses or inside one (Tavakoli 2011). This says more than a raw pause count.

**Rules (all Estimated)**

| Measure | Definition | Unavailable when |
| --- | --- | --- |
| **Run** | **Runs:** consecutive timed segments whose gaps are under the pause threshold (700 ms). An untimed segment ends a run.<br>**Mean run:** total words in runs ÷ number of runs.<br>**Longest run:** the most words in one run. | no timed segments ("Segment timings are unavailable."), or fewer than 20 words |
| **Pause location** | For each pause between segment *i* and *i+1*:<br>**boundary** if segment *i* ends with `. ? ! ; : ,` or segment *i+1* starts with a clause starter (`and but so because which who when if then although while after before that or`);<br>otherwise **mid-clause**. | pauses unavailable (same reason as v1) |
| **Words you use often** | Default list, counted on normalized tokens, multi-word items matched as sequences: `basically, actually, literally, honestly, obviously, you know, I mean, so yeah, or something, and stuff, and so on`. Stored as per 100 words; the per-word counts are listed. | fewer than 20 words |
| **Hedges** | `maybe, perhaps, probably, possibly, I think, I guess, I suppose, kind of, sort of, a bit, a little bit, somewhat, I'm not sure`, per 100 words | fewer than 20 words |
| **Vocabulary range** | **Different words per 50:** the mean number of distinct words in every 50-word window (moving window, step 1). Fillers are excluded; contractions count as one word. | fewer than 50 words ("Needs at least 50 words.") |
| **Opener** | The first sentence (text up to the first `. ? !`, max 200 chars).<br>**Hint** `starts_with_hesitation` when the first token is a filler candidate, or the opening is "so, um" / "um, so". | empty transcript |
| **Ending** | The last sentence.<br>**Hint** `trails_off` when the last tokens are `so yeah`, `and yeah`, `that's it`, `or something`, `and stuff`, `I guess` or `yeah`. | empty transcript |

- The vocabulary window follows MATTR (Covington & McFall 2010).
- "Like" is not in the default list because most uses are ordinary (D-16). You can add it in 8.11, and the summary then says "counts every 'like', including ordinary uses".

**Native, `src-tauri/src/analysis.rs`**
```rust
pub const DEFINITION_VERSION: u32 = 2;   // v1 runs stay stored; v2 runs are added by backfill_measures
const CLAUSE_STARTERS: [&str; 16] = ["and","but","so","because","which","who","when","if","then","although","while","after","before","that","or","where"];
pub const WATCH_WORDS: [&str; 11] = ["basically","actually","literally","honestly","obviously","you know","i mean","so yeah","or something","and stuff","and so on"];
pub const HEDGES: [&str; 13] = ["maybe","perhaps","probably","possibly","i think","i guess","i suppose","kind of","sort of","a bit","a little bit","somewhat","i'm not sure"];
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct Runs { pub mean_words: f64, pub longest_words: u32, pub longest_from_segment: usize, pub longest_to_segment: usize, pub count: u32 }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct WordCount { pub word: String, pub count: u32, pub segments: Vec<usize> }
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct Edge { pub text: String, pub segment: usize, pub hint: Option<&'static str> }
// Measures gains:
pub runs: Option<Runs>, pub runs_unavailable_reason: Option<String>,
pub pause_kinds: Vec<&'static str>,                 // parallel to `pauses`: "boundary" | "mid_clause"
pub watch_words: Vec<WordCount>, pub hedges: Vec<WordCount>, pub words_unavailable_reason: Option<String>,
pub different_per_50: Option<f64>, pub vocabulary_unavailable_reason: Option<String>,
pub opener: Option<Edge>, pub ending: Option<Edge>,
// helpers (pub for tests):
pub fn tokens(text: &str) -> Vec<String>;                       // normalize() each whitespace word, drop empty
pub fn count_sequences(tokens: &[String], items: &[&str]) -> Vec<WordCount>;
pub fn different_per_window(tokens: &[String], window: usize) -> Option<f64>;
pub fn first_sentence(text: &str) -> Option<String>; pub fn last_sentence(text: &str) -> Option<String>;
```
- `record_measures` stores these **new metric keys**:
  - `mean_run_words` (words);
  - `longest_run_words` (words);
  - `mid_clause_pauses` (pauses);
  - `boundary_pauses` (pauses);
  - `watch_words_per_100` (per 100 words);
  - `hedges_per_100` (per 100 words);
  - `different_words_per_50` (words).

  The six v1 keys are also stored under the v2 run, with the run ID `{revision}--measures-v2`.
- The settings JSON adds `"clauseStarters": "v1", "watchWords": "default-v1", "hedges": "v1", "window": 50`.
- `backfill_measures` already fills missing runs for the current version, so every stored revision gets v2 on the first start after the update.
- **Keep filler decisions attached.** Your hesitation decisions (`annotations`) are stored with `analysis::DEFINITION_VERSION`. Bumping that number to 2 would leave every earlier decision on version 1, where v2 views and facts don't look. Add `FILLER_DEFINITION_VERSION = 1` for the filler candidate list and use it for annotations, so decisions survive measures v2 as long as the candidate list is unchanged. The facts (7.6) read decisions with the same constant.

**IPC.** `TranscriptMeasures` (zod) gains these optional fields:
```ts
runs: z.object({ meanWords: z.number(), longestWords: z.number().int(), longestFromSegment: z.number().int(), longestToSegment: z.number().int(), count: z.number().int() }).nullable().optional(),
runsUnavailableReason: z.string().nullable().optional(),
pauseKinds: z.array(z.enum(["boundary", "mid_clause"])).optional(),
watchWords: z.array(WordCount).optional(), hedges: z.array(WordCount).optional(), wordsUnavailableReason: z.string().nullable().optional(),
differentPer50: z.number().nullable().optional(), vocabularyUnavailableReason: z.string().nullable().optional(),
opener: Edge.nullable().optional(), ending: Edge.nullable().optional(),
```
- They are optional, so v1 measures still parse.
- Facts (7.6) bump to `factsVersion: 2`, and `FactTake` gains: `meanRun`, `longestRun`, `midClausePauses`, `boundaryPauses`, `watchPer100`, `hedgesPer100`, `differentPer50`. All are nullable numbers, read from `metric_values`.
- The mock adds v2 values to its sample transcripts.

**Front end**
- `src/lib/insights/words.ts`: `countWatchWords(text: string, extra: string[]): WordCount[]`, the same algorithm in TypeScript for your own added words (8.11). It is tested against shared vectors (below).
- The display goes into the take summary (8.3).

**Tests**
- Rust, in `analysis.rs` tests:
  - `runs_join_segments_closer_than_the_threshold`;
  - `untimed_segment_ends_a_run`;
  - `runs_need_twenty_words`;
  - `pause_after_punctuation_or_before_a_clause_starter_is_a_boundary`;
  - `pause_inside_a_clause_is_mid_clause` ("I went to the | store").
- More Rust tests:
  - `multi_word_items_are_counted_as_sequences_and_not_double_counted` ("I mean" inside "I meant" is not counted);
  - `different_words_per_50_needs_fifty_words_and_excludes_fillers`;
  - `opener_hint_flags_a_leading_filler`;
  - `ending_hint_flags_so_yeah`;
  - `v2_backfill_adds_runs_without_touching_v1`.
- **Shared vectors.** `src-tauri/tests/fixtures/word-vectors.json` holds text with expected counts. It is used by a Rust test and by `src/lib/insights/words.test.ts`, so both implementations agree (vectors include apostrophes, capitals, punctuation, "I'm not sure").
- A-22: `a22-no-scores.test.tsx` adds v2 variants to its `transcript()` fixtures.

**Done when**
- every revision has a v2 run after the upgrade;
- the measures display without a score;
- the values match the vectors.

---

## 8.2 Phrases spotted in your takes

**Goal.** Close the loop between Phrases and speaking: when a phrase you keep shows up in a take, the app notices ("Saved phrase you used"). This is the evidence behind the Vocabulary levels (appendix A) and the achievement "Used a saved phrase in a take".

**Rules (`analysis::phrase_match`, Estimated)**
1. Tokenize the expression and the transcript with `tokens()`. Drop articles ("a", "an", "the") from both sides when comparing.
2. **Stem each token:**
   - strip `'s`;
   - for tokens longer than 4 characters, strip the endings `ing`, `ed`, `es`, `s`, in that order, once;
   - map common irregular verbs (`IRREGULAR` table of about 60 pairs: lost→lose, took→take, made→make, went/gone→go, said→say, thought→think, felt→feel, got→get, gave→give, came→come, knew→know, found→find, left→leave, kept→keep, began→begin, brought→bring, stood→stand, told→tell, spoke→speak, wrote→write…).
3. **Placeholders:** `something`, `someone`, `somebody`, `sth`, `sb` and `X` in an expression match 1–4 tokens.
4. **Match:** all expression tokens appear in order, with at most one extra token between any two. A match is reported with its segment and token range.
5. Very short expressions (one content word after dropping articles) never match, to avoid noise like "nice".

**Native**
- `analysis.rs`:
  - `pub fn phrase_match(expression: &str, tokens: &[String]) -> Option<(usize, usize)>`
  - `pub fn stem(token: &str) -> String`
- `storage/insights.rs` (new):
  - `fn record_phrase_uses(conn, attempt_id, revision_id)` runs inside `record_measures` for every non-deleted card;
  - `impl DatabaseOwner`:
    - `pub fn rescan_phrase(&self, card_id: &str) -> Result<u32>` scans the current revisions of takes from the last 365 days, at most 2,000, and returns the number of uses found;
    - `pub fn list_phrase_uses(&self, card_id: Option<&str>) -> Result<Vec<PhraseUse>>`.
- `add_phrase` and `update_phrase` call `rescan_phrase` after committing. When a card is deleted, its uses stay but are filtered out of facts.
- Commands (`commands/insights.rs`):
  - `list_phrase_uses(card_id: Option<String>) -> Vec<PhraseUse>`;
  - `PhraseUse { phraseId, attemptId, sessionId, revisionId, segment, localDate }` (no text).

**IPC.** `PhraseUse` schema; `listPhraseUses(phraseId?: string)`; facts `FactTake.phraseIds: string[]`; `keys.phraseUses(id)`.

**Front end**
- Take summary (8.3): a "Saved phrases you used" row lists each phrase's expression as a link to Phrases (`/phrases?id=`), plus the segment number with **Listen** (seek to the segment start). It carries the Estimated label and the hint "Matched by words, so a different meaning can match too."
- `PhrasesPage.tsx`: each card shows "Used in 2 takes" (or nothing). It expands to a list of session titles and dates, each linking to `/sessions/:id/attempt/:ordinal`.

**Tests**
- Rust:
  - `phrase_match_handles_tense_plural_articles_and_placeholders`;
  - `phrase_match_refuses_one_word_expressions`;
  - `phrase_match_allows_one_extra_word_between_tokens_but_not_two`;
  - `uses_are_recorded_for_new_revisions_and_rescanned_when_a_phrase_is_added`;
  - `uses_are_purged_with_the_take`.
- Vitest:
  - `PhrasesPage.test.tsx` `it("shows where a phrase was used")`;
  - `TakeSummary.test.tsx` `it("lists saved phrases spotted in the take")`.

**Done when** adding the phrase "lose track of time" finds an earlier take with "I lost track of the time", and the take summary and Phrases page show it.

---

## 8.3 Self-checks and take summary v2

**Goal.** Two questions a listener cares about most:
- Did you open with your point?
- Did you finish clearly?

Asked as a quick note *you* make (§11 "Main point clarity: user/listener rating"), with the opening and ending sentences quoted to help you judge. Then the take summary is reorganised to fit the v2 measures.

**Screens.** The take summary (`src/features/review/TakeSummary.tsx`) in the Studio take row and the session review:
```
┌ Take 2 · 1:04 ───────────────────────────────────────────── Estimated ┐
│ What went well   Your longest run: 14 words, from "So the first…"      │
│ One thing to try Pause at the end of a thought, not in the middle (2   │
│                  pauses fell inside a clause)                          │
├ Flow ─────────────────────────────────────────────────────────────────┤
│ Mean run 7.4 words · Longest 14 · Pauses: 5 between clauses, 2 inside │
│ Hesitation candidates 3 (review)  · Pace about 126 words a minute      │
├ Words ────────────────────────────────────────────────────────────────┤
│ Words you used often: actually 3 · you know 2                          │
│ Hedges: 4 · Different words: 37 in every 50                            │
│ Saved phrase you used: "I lost track of time" ▸ Listen                 │
├ Quick self-check · Your note ─────────────────────────────────────────┤
│ Opening: "Um, so the first thing I do is…"  [starts with a hesitation] │
│ Did you open with your point?      (Yes) (Not this time)               │
│ Ending:  "…so yeah."                         [trails off]              │
│ Did you finish clearly?            (Yes) (Not this time)               │
└───────────────────────────────────────────────────────────────────────┘
```
- **Flow** and **Words** are `<details>` that are open on the latest take and folded on the others.
- The self-check uses `ToggleGroup` (single choice), which can be cleared by clicking the selected item again. The saved state shows immediately, with no Save button.
- **Feedback timing (11.4):** when `feedbackTiming` is `on_request`, the Flow and Words sections are folded behind "Show measures".

**Rules**
- **"What went well"** (extend `summarizeTake`) picks the first that applies:
  1. A personal record (M9).
  2. A saved phrase used.
  3. The longest run is at least 12 words.
  4. All pauses fell between clauses.
  5. The v1 items (pace available, a reviewed take).
- **"One thing to try"** picks the first that applies:
  1. Two or more mid-clause pauses → "Pause at the end of a thought, not in the middle".
  2. The opener hint → "Try opening with your point".
  3. The ending hint → "Try finishing with one sentence that sums up".
  4. A watch word at least 3 times → "Notice how often you say 'actually'".
  5. The v1 items.
- Each line carries the Estimated label; self-check results show the Your note label.
- **Third question.** "Did you vary your voice on purpose?" (`varied_voice`) appears only on takes of 90 s or more. It feeds Voice & delivery level 5 (appendix A).
- **Activity checks.** Drills add their own checks (`concrete_detail`, `fair_other_side`, `kept_main_point`, `used_all_icons`, `fit_*`) in their result screens, not in the general summary.

**Native**
- `storage/insights.rs`:
  - `pub fn set_self_check(&self, attempt_id: &str, check_id: &str, value: Option<bool>) -> Result<()>` (None deletes);
  - `pub fn list_self_checks(&self, attempt_id: &str) -> Result<Vec<SelfCheck>>`;
  - `CHECK_IDS: ["point_first","clear_ending","varied_voice"]`; M10 adds `concrete_detail`, `fair_other_side`, `kept_main_point`, `used_all_icons`, `fit_child`, `fit_colleague`, `fit_expert`.
- Commands: `set_self_check`, `list_self_checks`.
- Facts: `FactTake.checks: { pointFirst?: boolean; clearEnding?: boolean; … }`.

**IPC**
```ts
export const SelfCheckId = z.enum(["point_first", "clear_ending", "varied_voice", "concrete_detail", "fair_other_side", "kept_main_point", "used_all_icons", "fit_child", "fit_colleague", "fit_expert"]);
export const SelfCheck = z.object({ attemptId: Id, checkId: SelfCheckId, value: z.boolean(), createdAt: z.string() }).strict();
setSelfCheck(attemptId: string, checkId: SelfCheckId, value: boolean | null): Promise<void>;
listSelfChecks(attemptId: string): Promise<SelfCheck[]>;
// keys.selfChecks(attemptId) = ["engagement", "selfChecks", attemptId]; mutation meta { engagement: true } (9.10)
```

**Front end**
- `src/features/insights/SelfChecks.tsx`: `SelfChecks({ attemptId, opener, ending }: { attemptId: string; opener: Edge | null; ending: Edge | null })`.
- `TakeSummary.tsx`: restructured into `WentWell`, `FlowSection`, `WordsSection` and `SelfChecks`. `summarizeTake` stays exported and pure, and gains a `facts?: { personalBest?: … }` argument in M9.

**Tests**
- `TakeSummary.test.tsx`:
  - `it("shows runs and pause location with the Estimated label")`;
  - `it("suggests pausing between thoughts when two pauses fell inside a clause")`;
  - `it("hides Words when the take has fewer than 20 words, with the reason")`.
- `SelfChecks.test.tsx`:
  - `it("saves a choice immediately and clears it when clicked again")`;
  - `it("quotes the opening and ending sentences")`.
- A-35 (new, `src/acceptance/a35-self-reports.test.tsx`): self-check answers carry Your note and never sit inside a measure's row. The test checks that the DOM ancestor of each self-check is the self-check section.
- A-22 extension: render `TakeSummary` with v2 fixtures and run `expectNoScores`.

**Done when** the latest take in the Studio shows the v2 summary and self-checks, which round-trip through native storage and appear in facts.

---

## 8.4 Waveform markers

**Goal.** See where things happened and jump there: pauses, hesitation candidates, and later liked sentences (12.4), section marks (14.3) and word-bomb words (10.4).

**Screens.** The review waveform (`src/features/review/WaveformPlayer.tsx`):
- **Thin ticks over the waveform.** Pauses are a shaded span, using `--cp-marker-pause`. Hesitation candidates are a dashed tick, because they are approximate (segment start), using `--cp-marker-filler`.
- **A row of small toggles above it:** Pauses · Hesitations (and later Liked · Sections · Words).
- **A marker list below it** for keyboard and screen-reader use: buttons such as "Pause 1.2 s at 0:12" or "Hesitation candidate near 0:31". Clicking one seeks there.
- **Keys** while the player has focus: `[` and `]` jump to the previous or next marker.

**Front end**
- `src/features/review/markers.ts`:
  ```ts
  export type WaveMarker = { id: string; kind: "pause" | "filler" | "liked" | "section" | "word"; startMs: number; endMs?: number; label: string; approximate: boolean };
  export function markersFromTranscript(t: AttemptTranscript): WaveMarker[]   // pauses from voice.pauses if present, else measures.pauses; fillers at segmentStartMs (approximate)
  export function nextMarker(markers: WaveMarker[], atMs: number, dir: 1 | -1): WaveMarker | null
  ```
- `WaveformPlayer.tsx` gets new props `markers?: WaveMarker[]` and `onMarkerKindsChange?`, and renders an absolutely positioned overlay sized to the waveform container. The overlay ignores pointer events except on the ticks.
- Tokens: add `--cp-marker-pause`, `--cp-marker-filler` and `--cp-marker-liked` in light and dark.

**Tests**
- `markers.test.ts`:
  - `it("prefers voice pauses and marks filler candidates as approximate")`;
  - `it("finds the next and previous marker")`.
- `WaveformPlayer.test.tsx` (extend `waveform.test.tsx`):
  - `it("seeks when a marker is chosen from the list")`;
  - `it("jumps with [ and ]")`.

**Done when** a reviewed take shows markers and the list in both themes, and axe stays clean.

---

## 8.5 A/B listen

**Goal.** Your ear is the best judge. Hear two takes back to back, at the same point, at matched loudness, and optionally without knowing which is which. This includes takes from different sessions: re-answers (11.1) and the time capsule (14.5).

**User flow**
1. **Open the comparison.** In a session review, **Compare** offers:
   - takes in this session (existing);
   - an earlier answer to the same prompt (same `contentId`);
   - your first take ever (the baseline).

   It opens `/compare?a=<attemptId>&b=<attemptId>`.
2. **Listen and switch.** Press **A** or **B** to play. **Switch** (key S) jumps to the other take at the same elapsed time.
3. **Choose blind (optional).** With **Hide which is which** on, the takes become X and Y in a random order. Choose **X sounds clearer**, **Y sounds clearer** or **About the same**; then **Reveal**.
4. **Save the choice.** It goes to `sessions.preferred_take` when both takes are in one session (existing 4.14), or to `comparisons` otherwise. It is labelled Your note.

**Screens**
```
┌ Compare · "Explain a habit" ──────────────────────────────────────────┐
│  [A] Take 1 · 12 Sep · 1:02     ▶ ━━━━━━━━○━━━━━━━   0:21             │
│  [B] Take 3 · 14 Oct · 0:58     ▶ ━━━━━━━━━━○━━━━━   0:21             │
│  (Switch at same point · S)  [x] Level-matched   [ ] Hide which is which│
│  Which sounded clearer to you?  (A) (B) (About the same) · Your note   │
│  Measures side by side ▸ (pace, mean run, pauses inside a clause …)     │
└───────────────────────────────────────────────────────────────────────┘
```
- **Level matching** is on by default. It attenuates the louder take so the RMS levels match: no boost above 1.0, at most −12 dB. The hint reads: "So the louder take doesn't simply sound better."
- **Measures side by side** is folded by default (it is listen first) and is unavailable in blind mode until you reveal.

**Native**
- Commands (`commands/insights.rs`):
  - `save_comparison(a_attempt, b_attempt, preferred, blind) -> Comparison`;
  - `list_comparisons(attempt_id) -> Vec<Comparison>`.
- The RMS level comes from the existing waveform peaks: a new pure function `audio::peaks::rms_from_peaks(peaks: &[u16]) -> f32` (unit-tested). The UI receives the peaks already, through `getRecordingWaveform`.

**Front end**
- `src/features/insights/AbListen.tsx`:
  ```ts
  export function AbListen({ a, b, sessionTitle }: { a: AttemptRef; b: AttemptRef; sessionTitle: string }): JSX.Element
  export function matchGains(rmsA: number, rmsB: number): { a: number; b: number }   // pure, tested
  export function blindOrder(seed: string): ["a", "b"] | ["b", "a"]                     // seededRandom (src/lib/engagement/random.ts)
  ```
- `ComparePage.tsx` uses `AbListen` for its two chosen takes.
- New route `compare` → `src/features/insights/CrossComparePage.tsx` (lazy) reads the `?a=` and `?b=` query.
- Uses `audio-player.tsx`'s element API. If a shared-player hook isn't exported, extract `useAudioElement(url)` from `audio-player.tsx` first.

**Tests**
- `AbListen.test.tsx`:
  - `it("switches to the other take at the same position")`;
  - `it("attenuates the louder take only")`;
  - `it("hides labels and measures in blind mode until reveal")`;
  - `it("saves the choice as your note")`.
- `matchGains` unit tests at edges: equal levels, silence, a 20 dB difference.
- Rust:
  - `comparisons_are_purged_when_either_take_is`;
  - `rms_from_peaks_matches_a_known_signal`.

**Done when** both entry points work in the desktop app, and blind mode keeps the identity hidden until you reveal.

---

## 8.6 Trends, plus Progress built from facts

**Goal.** Show how the new measures move over time, kept apart for rehearsed answers and unfamiliar tasks as now, without the N+1 IPC calls.

**Screens.** Progress → Rehearsed and Unfamiliar views add a **Trends** grid under the pace chart. It has four small charts, two per row (one on narrow screens):
- **Mean run** (words);
- **Pauses inside a clause per minute**;
- **Different words per 50**;
- **Confirmed hesitations per 100 words**: reviewed takes only, with the subtitle "From takes where you reviewed every candidate".

Each chart:
- carries the Estimated label;
- shows the points, plus a "typical for you" line (rolling median of 5);
- has **no target line and no colouring of better or worse**;
- falls back below 4 points to the existing empty state ("More comparable sessions are needed for a trend").

**Front end**
- `src/lib/insights/trends.ts`:
  ```ts
  export type TrendPoint = { date: string; sessionId: string; attemptId: string; value: number };
  export type Trend = { key: "meanRun" | "midClausePerMin" | "differentPer50" | "confirmedPer100"; points: TrendPoint[]; typical: { date: string; value: number }[] };
  export function buildTrends(facts: PracticeFacts, view: "rehearsed" | "unfamiliar"): Trend[]
  export function rollingMedian(values: number[], window: number): number[]
  ```
- **Which take counts** follows `evidenceTakes` (A-18): the latest transcribed take for rehearsed answers, the first take for unfamiliar tasks.
- `native-client.ts` `getProgress` is rewritten over `getPracticeFacts()` using a new `buildProgressFromFacts(view, facts)` in `today-plan.ts`, and the per-session `get_session` loop is removed. `buildProgress` stays for the mock until the mock builds facts. The ProgressSummary output must be identical: a test asserts both builders on the same data.
- `src/features/insights/Trends.tsx`: `Trends({ view })`, Recharts `LineChart` × 4, with axis font size 13 (the earlier fix).

**Tests**
- `trends.test.ts`:
  - `it("uses the first take of unfamiliar sessions and the latest transcribed take of rehearsed ones")`;
  - `it("needs four points")`;
  - `it("rolling median ignores missing values")`.
- `today-plan.test.ts`: `it("buildProgressFromFacts matches buildProgress on the same history")`.
- `ProgressPage.test.tsx`: `it("shows four trend charts with Estimated labels")`.
- A-26 (9.x) also covers Trends.

**Done when** Progress loads with one facts call, and the trends render in both themes.

---

## 8.7 Speech profile

**Goal.** One page that describes how you typically speak, so you know yourself, not so you get a grade: "A description, not a grade. Speakers differ; these show what's typical for you."

**Screens.** Progress gets a first tab, **Profile** (the tabs become Profile · Rehearsed · Unfamiliar · Real conversations), which is the default when there is no `?view=`.
```
┌ Your speech profile ─────────────────────── from your last 20 takes ┐
│ Typical pace          118–134 words a minute            Estimated   │
│   rehearsed 126 · unfamiliar 117                                     │
│ Typical run           7 words between pauses             Estimated   │
│ Pitch range           usually 5–8 semitones              Estimated   │
│ Speech rate (audio)   about 4.2 syllables a second       Estimated   │
│ Words you use often   actually · you know                Estimated   │
│ Hedges                about 3 in every 100 words         Estimated   │
│ Saved phrases used    4 in the last 30 days              Estimated   │
├ Since your first month ─────────────────────────────────────────────┤
│ Mean run        5.1 → 7.4 words                                      │
│ Different words 33 → 37 in every 50                                  │
│ Pace            112 → 124 words a minute                             │
└─────────────────────────────────────────────────────────────────────┘
```
- **Ranges** are the middle half (25th–75th percentile) of eligible takes.
- **"Since your first month"** compares the median of the first 30 days with practice against the last 30 days. It is shown only when each side has at least 5 takes. It has no colours and no arrows that imply better or worse, just "then → now".
- **Every row** links to Trends or to the takes it came from.

**Data**
- Facts add `FactTake.pitchRangeSt` (from `prosody_tracks.range_semitones`, current algorithm) and `FactTake.rateSps` (from `audio_measures`, 8.8). Both are nullable.

**Front end**
- `src/lib/insights/profile.ts`:
  ```ts
  export type ProfileRow = { key: string; label: string; value: string | null; detail: string | null; unavailableReason: string | null; source: "estimated" };
  export function buildProfile(facts: PracticeFacts, opts?: { recent?: number }): { rows: ProfileRow[]; since: ProfileRow[] | null }
  export function middleHalf(values: number[]): [number, number] | null
  ```
- `src/features/insights/SpeechProfile.tsx`.

**Tests**
- `profile.test.ts`:
  - `it("uses the middle half of the last 20 takes")`;
  - `it("hides since-first-month until each side has five takes")`;
  - `it("explains missing pitch range when no take has an intonation track")`.
- `SpeechProfile.test.tsx`: `it("renders every row with a label and no score words")`, using `expectNoScores`.

**Done when** the profile renders from facts and every row explains where it came from.

---

## 8.8 Syllable rate and the live pace meter

**Goal.** Estimate speaking rate from the audio itself, with no transcript needed, after de Jong & Wempe (2009): count syllable nuclei (intensity peaks that are voiced).
- **After a take:** a speech-rate value for the profile and for the pace ladder (10.7).
- **During a take (optional):** a calm live meter showing where you are compared with your usual range.

It is never a target speed (D-34; §7 "Do not demand faster speech").

**Rules (method `nuclei-v1`)**
1. **Intensity.** Downmix to mono. Compute intensity in dB over 50 ms frames with a 10 ms hop.
2. **Threshold.** The 99th-percentile intensity minus 25 dB.
3. **Peaks.** A peak counts when it is above the threshold and preceded and followed by a dip of at least 2 dB.
4. **Voicing check.** Keep a peak only if `prosody::yin` finds a pitch in the 40 ms around it.
5. **Pauses.** Silences of at least 300 ms below the threshold.
6. **Rates:**
   - **Rate:** nuclei ÷ (last nucleus − first nucleus);
   - **Articulation rate:** nuclei ÷ phonation time (the span minus pauses).
7. **Unavailable** when there are fewer than 10 nuclei or less than 5 s of span ("Needs at least 5 seconds of speech.").
8. **Live counter.** A sliding 8 s window, updated every 1 s, with the 99th percentile tracked over the last 30 s using a 1 dB histogram. It shows nothing until 3 s of voiced audio exist.

**Native**
- `src-tauri/src/audio/syllables.rs` (new):
  ```rust
  pub const METHOD: &str = "nuclei-v1"; pub const DEFINITION_VERSION: u32 = 1;
  pub struct RateResult { pub nuclei_ms: Vec<u64>, pub span_ms: Option<u64>, pub phonation_ms: Option<u64>,
      pub rate_sps: Option<f64>, pub articulation_sps: Option<f64>, pub unavailable_reason: Option<String> }
  pub fn detect(samples: &[f32], sample_rate: u32) -> RateResult
  pub struct LiveCounter { /* ring buffers, histogram */ }
  impl LiveCounter { pub fn new(sample_rate: u32) -> Self; pub fn push(&mut self, mono: &[f32]) -> Option<LiveRate>; }
  #[derive(Serialize)] #[serde(rename_all = "camelCase")]
  pub struct LiveRate { pub syllables_per_second: Option<f32>, pub voiced_ms: u32, pub window_ms: u32 }
  ```
- `storage/insights.rs`:
  - `pub fn audio_measures(&self, attempt_id: &str) -> Result<AudioMeasures>` computes from the take's original WAV on first request (as `prosody()` does), stores the row and returns it.
- Commands: `get_audio_measures(attempt_id)`, run in `spawn_blocking`.
- **Capture integration:**
  - `audio::capture::StartRequest` gains `live_pace: bool` (default false). The `start_recording` command accepts an optional `livePace`.
  - The writer thread, which already consumes blocks, owns a `LiveCounter` when enabled and emits `live_pace` events through the existing `EventSink`, at most once a second.
  - Nothing is stored live; the stored value is computed afterwards from the saved file.
- Performance: per block (4,096 samples) this is O(n), plus YIN on at most about 8 peaks a second. The target is ≤ 3% of one core (manual check).

**IPC**
```ts
export const AudioMeasures = z.object({ attemptId: Id, method: z.literal("nuclei-v1"), syllables: z.number().int().nullable(), spanMs: z.number().int().nullable(),
  phonationMs: z.number().int().nullable(), rateSps: z.number().nullable(), articulationSps: z.number().nullable(), unavailableReason: z.string().nullable() }).strict();
export const LivePace = z.object({ attemptId: Id, syllablesPerSecond: z.number().nullable(), voicedMs: z.number().int(), windowMs: z.number().int() }).strict();
getAudioMeasures(attemptId: string): Promise<AudioMeasures>;
onLivePace(listener: (p: LivePace) => void): Promise<() => void>;
// startRecording request gains livePace?: boolean
```
- The mock simulates a gently varying rate around 4.2 syllables a second while recording when `livePace` is true.

**Front end**
- `src/features/insights/LivePaceMeter.tsx`: `LivePaceMeter({ rate, usual }: { rate: number | null; usual: [number, number] | null })`.
  ```
  slower ·················[████ your usual ████]················· faster
                                     ●  about 4.1 syllables a second · Estimated
  ```
  - It shows "Listening…" until there is a value.
  - It never uses red or green: the band is `--cp-ring-track` and the dot is `--cp-accent`.
  - Screen readers get no live updates; the meter has `aria-hidden` plus an sr-only line, "Live pace is shown visually; it is an estimate."
  - The `usual` band comes from the profile (8.7), as the middle half of `rateSps`.
- `RecorderPanel` (7.9) renders it in the `inside` slot when `preferences.livePace` is true or the activity forces it.
- Settings → Practice → **Show live pace while recording** (Switch), with the hint "An estimate from the audio. There's no right speed; it shows your range."
- The take summary adds "Speech rate (audio) about 4.0 syllables a second" (Estimated) via `getAudioMeasures`.

**Tests**
- Rust, `syllables.rs`:
  - `counts_synthetic_voiced_bursts_within_ten_percent`: a 150 Hz tone amplitude-modulated at 3, 4 and 5 Hz for 10 s;
  - `ignores_unvoiced_noise_bursts`;
  - `needs_five_seconds_and_ten_nuclei`;
  - `live_counter_matches_offline_detect_on_the_same_signal_within_ten_percent`;
  - `live_counter_is_silent_until_three_seconds_voiced`.
- Rust benchmark, `#[ignore]`: `rate_on_the_public_sample_is_close_to_transcript_syllables`. The Nyra sample (D-24) with its transcript: count syllables in the transcript by vowel groups, and expect within ±15%. Note the result in DEVELOPMENT_PLAN Notes.
- Rust: `audio_measures_are_computed_once_and_purged_with_the_take`.
- `net_guard`: `syllable_detection_builds_no_http_client` (A-32).
- Vitest:
  - `LivePaceMeter.test.tsx`:
    - `it("places the dot inside the usual band")`;
    - `it("says Listening until a value arrives")`;
    - `it("uses no colour words or scores")`;
  - recorder test: `it("passes livePace to startRecording when enabled")`.
- Manual: record 60 s with live pace on; watch CPU in Task Manager; the meter moves smoothly and holds still in silences.

**Done when** the synthetic tests pass, the public sample is within ±15%, the meter works in the desktop app, and CPU stays within budget.

---

## 8.9 Sequence dots

**Goal.** You see where you are in today's sequence at a glance.

**Front end.** `SequenceBar.tsx` shows a row of dots before the text, one per step:
- done: filled with a check;
- current: a ring;
- upcoming: hollow.

Each dot has an `aria-label` such as "Step 2 of 4, Thought groups, current". The dots are not interactive.

**Tests.** `sequence.test.tsx`: `it("marks done, current and upcoming steps")`.

**Done when** the bar matches the design in both themes.

---

## 8.10 Ctrl+K actions

**Goal.** The command palette does things, not only finds things.

**Front end**
- `src/app/palette-actions.ts`:
  ```ts
  export type PaletteAction = { id: string; label: string; keywords: string[]; icon: LucideIcon; group: "Actions";
    visible: (ctx: PaletteContext) => boolean; run: (ctx: PaletteContext) => void };
  export type PaletteContext = { navigate: NavigateFunction; preferences: Preferences; setTheme: (t: Theme) => void; zoom: (d: 1 | -1 | 0) => void; playful: boolean };
  export const PALETTE_ACTIONS: PaletteAction[]
  ```
- The actions:
  - Start today's practice;
  - Record a quick take (the Studio with the first prompt);
  - Review due phrases;
  - Add a real-conversation reflection;
  - Switch theme (light, dark, system);
  - Zoom in, out or reset;
  - Open Journey (Playful only, from 9.1);
  - Play Just a Minute (from 10.2);
  - Start a conversation (from 13.x).
- `CommandPalette.tsx` renders an **Actions** group above **Go to** when the query is empty or matches.

**Tests.** `CommandPalette.test.tsx`:
- `it("runs an action and closes")`;
- `it("hides Journey in calm style")`.

**Done when** the actions work by keyboard alone.

---

## 8.11 Settings → Words to watch

**Goal.** You decide which habits to notice; the app doesn't decide for you.

**Front end.** Settings → Practice → **Words to watch**:
- the default list as read-only chips, with the hint "Counted in every take";
- **Your words**: an input plus Add, and removable chips. Each is at most 30 characters, with at most 20 words.

Saved in `preferences.watchWords`, and used by `countWatchWords` in the take summary.

**Tests**
- Rust: `watch_words_are_trimmed_deduplicated_and_limited`.
- Vitest: `it("adds and removes your own words")`.

**Done when** an added word shows up in the next take summary that contains it.
