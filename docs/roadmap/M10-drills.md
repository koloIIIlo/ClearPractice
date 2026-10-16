# M10: Drills

> **Goal.** Add short practice games that are fun on their own and train specific skills:
> - **Just a Minute**;
> - **Topic roulette**;
> - **Word bomb**;
> - **Explain it three ways**;
> - **Emphasis game**;
> - **Pace ladder**;
> - **Story spine** and **Story cubes**;
> - **Elevator pitch**;
> - **Steelman**;
> - **Daily prompt**;
> - **Gauntlet**;
> - **Boss levels**.
>
> Every drill:
> - uses the normal recorder, so audio is always safe (P-9, A-31);
> - saves as a normal session with an activity snapshot (7.3);
> - feeds levels, records and achievements (M9).
>
> **What you'll see.** A **Drills** tab in Exercises, a drill studio, drill results, and a daily prompt card.
>
> **Schema.** v19. **Effort.** 16–22 days. One drill per session after 10.1 is a good parallel split.
>
> **Exit gate**
> - Every drill playable in the desktop app.
> - A-31 passes, including the manual crash recipe.
> - A-26 covers every result screen.
> - Results match their Rust tests.
> - Content lists meet appendix C counts.

| WP | Title | Effort |
| --- | --- | --- |
| 10.1 | Drill framework: module contract, drill studio, clock, take events, results cache | L |
| 10.2 | Just a Minute | M |
| 10.3 | Topic roulette (with timing lights) | M |
| 10.4 | Word bomb | M |
| 10.5 | Explain it three ways | M |
| 10.6 | Emphasis game (prominence analysis) | L |
| 10.7 | Pace ladder | S |
| 10.8 | Story spine and Story cubes | M |
| 10.9 | Elevator pitch | S |
| 10.10 | Steelman | S |
| 10.11 | Daily prompt with share text | M |
| 10.12 | Gauntlet | S |
| 10.13 | Boss levels (scripted, offline) | M |
| 10.14 | Drills tab and cards | M |
| 10.15 | Drill content and tests | M |

**Schema v19**
```sql
-- Drills (M10). Marks made during a take (a word shown, a card advanced, a slip
-- you flagged), with the time into the take. IDs, keys and numbers only (A-30).
CREATE TABLE take_events (
 id INTEGER PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 at_ms INTEGER NOT NULL CHECK(at_ms >= 0),
 kind TEXT NOT NULL,
 data TEXT NOT NULL DEFAULT '{}',
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX take_events_attempt ON take_events(attempt_id, at_ms);
-- A drill take's result, computed on first request from the stored transcript,
-- audio measures and marks; recomputed when the transcript revision changes.
CREATE TABLE activity_results (
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 revision_id TEXT,
 result TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(attempt_id, definition_version)
) STRICT;
PRAGMA user_version=19;
```
**Purge.** `purge_take_rows` deletes `take_events` and `activity_results` along with the take.

---

## 10.1 Drill framework

**Goal.** One contract and one studio for all drills. A new drill should take about a day: a module, its content and its tests.

**Content**

`src/content/drills.ts`:
```ts
export type DrillDef = {
  id: string; type: ExerciseType; version: number; title: string; tagline: string; rules: string[];
  minutes: number; areas: AreaId[]; exerciseId: string;            // the drill's own exercise definition, e.g. "ex-jam" (D-30)
  icon: LucideIcon; needsTranscript: boolean;                       // the full result needs local Whisper
  defaults: Record<string, number | string | boolean>;
};
export const DRILLS: readonly DrillDef[];                         // appendix C, table "Drills"
```

**Exercise types (D-30).** Each drill is an exercise type of its own. For each drill:
- add the type to `exercise_types::KNOWN` (Rust), `ExerciseType` (zod) and `EXERCISE_TYPE_INFO` (label and icon);
- add its exercise definition (for example `ex-jam`, version 1) to `src/content/exercises.ts` as part of `DRILL_EXERCISES`.

The Exercises tab keeps listing the four core exercises; drills are listed on the Drills tab. No database change is needed: v16 removed the type check (7.3).

**Module contract**

`src/features/drills/drill-module.ts`:
```ts
export type DrillRound = { index: number; key: string; promptId: string | null; prompt: string;
  thinkSeconds: number; speakSeconds: number | null /* null: open-ended, you stop */; card?: ReactNode | string };
export type DrillPlan = { drill: DrillDef; seed: string; params: Record<string, unknown>; groupId: string | null;
  sessionPrompt: string; rounds: DrillRound[] };
export type DrillTake = { round: DrillRound; attemptId: string; durationMs: number };
export interface DrillModule {
  type: ExerciseType;
  plan(seed: string, params: Record<string, unknown>, ctx: { prompts: PracticePrompt[]; today: string }): DrillPlan;   // pure, deterministic
  Setup?: FC<{ plan: DrillPlan; onReady: (plan: DrillPlan) => void }>;     // roll, spin, pick a side…
  Live?: FC<{ round: DrillRound; elapsedMs: number; mark: (e: TakeMark) => void }>;  // inside the recorder while speaking
  Result: FC<{ plan: DrillPlan; takes: DrillTake[] }>;                      // reads getActivityResult per take
}
export type TakeMark = { kind: "word_shown" | "self_flag" | "card_advanced" | "cue_shown"; data: Record<string, string | number> };
export const DRILL_MODULES: Record<string, () => Promise<DrillModule>>;     // lazy import per drill
```

**Drill studio**

`src/features/drills/DrillStudio.tsx`, at route `drill/:drillId`, lazy; crumb = the drill title.
```
┌ Just a Minute · round 1 of 1 ─────────────────────────────── [Leave] ┐
│ Topic: "The best meal you've ever had"                    (Setup card) │
│ Speak for 60 seconds without hesitation, repetition or deviation.     │
│ ┌ Recorder (RecorderPanel) ─────────────────────────────────────────┐ │
│ │ (status pill)   ◯ 0:42 countdown ring (CountdownRing)             │ │
│ │ ~~~~ live waveform ~~~~                                            │ │
│ │ Live slot: "Press F to flag a slip you notice"                     │ │
│ │                (Start round)  /  (End round)                       │ │
│ └────────────────────────────────────────────────────────────────────┘ │
│ After: Result card (module.Result) · [Again, new topic] [Same topic]   │
└───────────────────────────────────────────────────────────────────────┘
```

**Clock**

`src/features/drills/useDrillClock.ts` is a state machine:
```ts
export type DrillPhase = "setup" | "ready" | "think" | "speak" | "saving" | "between" | "done";
export function useDrillClock(plan: DrillPlan, rec: Recorder, deviceId: string | null): {
  phase: DrillPhase; round: DrillRound; roundIndex: number; remainingMs: number;
  startRound(): void;     // the user's explicit start: think countdown, then rec.startNow
  endRound(): void;       // manual stop: rec.stopAndSave
  next(): void;           // between rounds: the next round's ready state
}
```
Rules:
- **Start:**
  - Recording never starts without your **Start round**.
  - The think countdown is part of the rules you chose.
  - Speaking starts by itself when the think countdown ends.
- **Stop:**
  - At `speakSeconds`, the clock calls `rec.stopAndSave()`; the take is saved like any other.
  - **End round** stops early.
  - If saving fails, the recorder's error and recovery apply unchanged.
- **Busy flag:** while the phase is think, speak or saving, `setDrillBusy(true)` (`src/features/drills/busy.ts`) so celebrations wait (9.10).
- **Announcements:** `aria-live` on round start, think start, speaking start, at 30, 10 and 5 seconds left, and at stop. Nothing every second.
- **Leave:** leaving during think cancels the countdown with no take. Leaving during speak uses the recorder guard ("A take is still recording").

**Countdown ring**

`src/features/drills/CountdownRing.tsx`:
```ts
export function CountdownRing({ totalMs, remainingMs, lights }: { totalMs: number; remainingMs: number;
  lights?: { greenAtMs: number; amberAtMs: number; redAtMs: number } }): JSX.Element
```
- An SVG ring of 160 px with the time in the centre (`text-5xl tabular-nums`).
- With `lights`, the ring stroke changes to `--cp-light-green`, then `--cp-light-amber`, then `--cp-light-red`. A text label under the ring always says which light is on: "Green: minimum time reached".
- Under reduced motion, the ring updates once a second without a transition.

**Take marks**

- During a take, `mark()` buffers `TakeMark` items with `at_ms = rec.elapsedMs`.
- After `stopAndSave` resolves, the studio calls `addTakeEvents(attemptId, marks)` once.
- If the app crashes mid-take, the marks are lost but the audio is recovered. The result then says "Marks from this round weren't saved."

**Native**

- `storage/drills.rs`:
  - `add_take_events(&self, attempt_id, events: &[TakeEventInput]) -> Result<u32>`, at most 200 per take. The kind comes from `activity::TakeEventKind`. Data must be keys and numbers only, ≤ 512 bytes.
  - `list_take_events(&self, attempt_id) -> Result<Vec<TakeEvent>>`.
- `src-tauri/src/activity_results.rs` (new, pure):
  - `pub const DEFINITION_VERSION: u32 = 1;`
  - One function per kind, each taking `ResultInputs { measures: Option<Measures>, voice: Option<VoiceActivity>, audio: Option<AudioMeasures>, events: Vec<TakeEvent>, snapshot: ActivityContext, step: Option<ActivityStep>, tokens: Vec<String> }` and returning a `serde_json::Value` of numbers and keys: `jam`, `word_bomb`, `emphasis`, `pace_ladder`, `story_cubes`, `story_spine`, `daily_grid`, `basic`.
- `storage/drills.rs`:
  - `activity_result(&self, attempt_id) -> Result<ActivityResult>` gathers the inputs, computes, and caches into `activity_results`.
  - A cached row whose `revision_id` differs from the current revision is recomputed.
- **XP:** `commit_recording` awards `drill_round` (15 XP, ref = session ID) on the first saved take of a session whose exercise type is a drill type (7.4 table, appendix B).
- **Commands** (`commands/drills.rs`): `add_take_events`, `list_take_events`, `get_activity_result`.
- **Facts** (factsVersion 3): `FactTake.result: Record<string, number> | null` comes from cached results with a matching revision; `FactSession.activity` already exists.
- The **transcription queue's `onDone`** calls `getActivityResult` for activity takes, so results (and therefore records) are cached without opening the result screen.

**IPC**
- `TakeMark`, `TakeEvent`, `ActivityResult` (a discriminated union by `kind` with per-kind zod objects; numbers nullable with `unavailableReason`).
- Methods: `addTakeEvents(attemptId, marks)`, `listTakeEvents(attemptId)`, `getActivityResult(attemptId)`.
- Key: `keys.activityResult(attemptId)`.
- The mock computes simple results from its sample transcripts.

**Tests**
- Rust:
  - `take_events_are_validated_capped_and_purged_with_the_take`;
  - `activity_result_is_cached_and_recomputed_after_a_correction`;
  - `drill_round_xp_once_per_session`.
- `useDrillClock.test.ts` (fake timers, mock recorder):
  - `it("never records before Start round")`;
  - `it("starts speaking after the think countdown")`;
  - `it("stops and saves at the limit")`;
  - `it("End round stops early")`;
  - `it("cancels think without a take on leave")`;
  - `it("sets the busy flag only while thinking, speaking or saving")`.
- `CountdownRing.test.tsx`:
  - `it("labels the light that is on")`;
  - `it("announces only at 30, 10 and 5 seconds")`.
- **A-31** (`src/acceptance/a31-drill-audio-safety.test.tsx`):
  - an auto-stop at the limit results in exactly one `stopRecording` call, and a saved take appears;
  - navigating away while speaking shows the guard;
  - the mock-simulated interrupted take is listed under recoverable recordings.
- **A-31 manual:**
  1. Start Just a Minute.
  2. Kill the app with Task Manager at 0:30.
  3. Reopen. **Observe:** "Your recordings on this computer" offers the interrupted take, and Recover saves it in the drill's session.

---

## 10.2 Just a Minute

**Idea.** The BBC Radio 4 classic: speak for 60 seconds without hesitation, repetition or deviation.

**Plan**
- One round.
- `thinkSeconds` 5, `speakSeconds` 60.
- The topic comes from `JAM_TOPICS` (120 short topics, appendix C), picked by `seededRandom(seed)`.
- The session prompt is `Just a Minute: <topic>`.
- **Again, new topic** starts a new session with a new seed. **Same topic** adds a take to this session.

**Live**
- A hint line: "Press **F** to flag a slip you notice (hesitation, repetition or going off topic)". The F key writes a `self_flag` mark.
- Flagging is awareness training, not a penalty game.

**Result** (`activity_results::jam`, Estimated). The penalties are subtracted from the speaking time:

| Penalty | Deduction |
| --- | --- |
| each hesitation candidate | 1.0 s (fillers in the measures) |
| each long pause inside speech | its duration (VAD pauses of 1.5 s or more) |
| each immediate repeat | 0.5 s (`repeated_words`) |
| each self-flag | 1.0 s |

- **Speaking time:** from the first to the last detected speech, at most 60 s.
- **Clean seconds:** the speaking time minus the penalties, never below 0, rounded down.
- **Without a transcript:** hesitations and repeats are unknown, so clean seconds are unavailable ("Needs a transcript"), but long pauses and self-flags still show.
- **Result card:**
  ```
  About 47 clean seconds  ·  Estimated          Your best: 52 (3 Oct)
  Hesitation candidates 3 · Long pauses 1 (2.1 s) · Repeats 2 · Your flags 1
  [timeline: 0–60 s with markers]   [Listen]  [Review candidates]
  [Again, new topic]  [Same topic]  [Done]
  ```

**Records and achievements**
- Record `jam_clean_seconds`.
- Achievements `jam-first`, `jam-45`, and `jam-10-rounds` (appendix B).

**Tests**
- Rust:
  - `jam_clean_seconds_subtracts_each_penalty_once`;
  - `jam_without_transcript_reports_pauses_and_flags_only`;
  - `jam_caps_speaking_time_at_sixty_seconds`.
- Vitest:
  - `jam/plan.test.ts`: `it("picks the same topic for the same seed")`;
  - `JamResult.test.tsx`: `it("shows clean seconds with Estimated and the previous best")`, plus `expectNoScores`.

---

## 10.3 Topic roulette

**Idea.** Toastmasters "Table Topics": spin, think briefly, speak.

**Setup**
- A wheel of 8 categories, built from `PromptTag` plus extras:
  - Daily life, Work, Opinions, Storytelling, Unexpected, Explanations, Hypotheticals, Memories.
- **Spin** rotates the wheel with CSS over 1.6 s, or instantly under reduced motion, to a seeded category.
- A topic is then drawn from `ROULETTE_TOPICS[category]` (appendix C: 20 per category).
- Options:
  - speaking time 30, 60, 90 or 120 s (default 60);
  - think 10 s (fixed by the rules);
  - **Re-spin** is allowed once.

**Live**
- `CountdownRing` with timing lights:
  - green at 2/3 of the time ("minimum reached");
  - amber at 11/12;
  - red at the full time.
- The take stops at the full time + 5 s grace; the lights say "Time".

**Result** (`basic`)
- The time spoken and the light reached ("You reached green at 0:41").
- The usual measures.
- The category and topic.

**Tests**
- `roulette/plan.test.ts`: `it("is deterministic per seed and respects the re-spin limit")`.
- `RouletteSetup.test.tsx`:
  - `it("announces the chosen category and topic")`;
  - `it("spins instantly under reduced motion")`.

---

## 10.4 Word bomb

**Idea.** An improv game: a random word appears while you speak, and you weave it in.

**Plan**
- A prompt from the familiar prompts, speaking 90 s.
- 3 bombs at seeded times between 15 and 75 s, at least 15 s apart.
- The words come from `WORD_BOMB_WORDS` (200 concrete nouns with IDs and simple plurals, appendix C).

**Live**
- At each bomb time, a card slides in above the button: "Weave in: **umbrella**". It stays until the next bomb or for 10 s.
- The card writes a `word_shown {wordId}` mark.
- Screen readers hear "New word: umbrella."

**Result** (`activity_results::word_bomb`, Estimated)
- A word counts as **woven in** when its stem (`analysis::stem`, 8.2) appears in a segment that starts at or after the time the word was shown, minus 1 s.
- Shows "Words woven in: 2 of 3", with each word linked to where it was spoken.
- Needs a transcript; without one, each word gets a "Did you use it? (Your note)" toggle instead.

**Records and achievements**
- Record `word_bomb_woven`.
- Achievement `word-bomb-all` (all three words woven in).

**Tests**
- Rust:
  - `word_bomb_counts_a_word_only_after_it_was_shown`;
  - `word_bomb_matches_plurals_and_tense`.
- `word-bomb/plan.test.ts`: `it("spaces bombs at least 15 seconds apart")`.
- `WordBombLive.test.tsx`: `it("shows each word at its time and records a mark")`.

---

## 10.5 Explain it three ways

**Idea.** The same explanation for three listeners. This combines the Feynman technique with audience adaptation (scheduler stage 3).

**Plan**
- One prompt: you pick a familiar explanation prompt, or type your own topic.
- 3 rounds, each open-ended (target 60 s, for information only):
  - `child` (a 10-year-old): "Short words, one everyday example";
  - `colleague` (a colleague from another team): "Skip the basics, say why it matters to them";
  - `expert` (an expert): "Be precise, name the trade-offs".
- Each round shows its audience card and tips.

**Result**
- **Per take** (`basic`, Estimated): words, different words per 50, and mean sentence length, shown in three columns.
- **Self-check** (Your note): "Which version fit its listener best?", with child, colleague, expert or "All about the same". The chosen version is stored as a `self_checks` row on that take (`fit_child`, `fit_colleague` or `fit_expert` = yes; already in `SelfCheckId`, 8.3). "All about the same" stores nothing.
- **Optional AI comparison**, only with Coaching set to API or Local:
  - "Did the wording change for each listener?";
  - previewed, Send only;
  - `Kind::ThreeWays` in `coaching.rs`, with the schema `{ perAudience: [{ audience, note, quote }], oneTip }`;
  - every quote is validated to exist in its transcript.

**Tests**
- `three-ways/plan.test.ts`: `it("creates three rounds with fixed keys")`.
- `ThreeWaysResult.test.tsx`: `it("shows three columns and saves which fit best")`.
- Rust: `three_ways_preview_contains_only_the_three_transcripts` and `quotes_must_exist_in_their_transcript`.

---

## 10.6 Emphasis game

**Idea.** Put the stress on a different word each time and hear the meaning change: "*I* didn't say she stole it", then "I didn't *say* she stole it"…

**Plan**
- 7 rounds. Each uses a sentence from `EMPHASIS_SENTENCES` (20 sentences of 6–9 words, appendix C) and a seeded target word.
- Each round is a short take (open-ended, typically 3 s).
- Its exercise type is `emphasis`, a read-aloud drill.
- The card shows the sentence with the target word underlined and in bold: "Stress **say**".

**Analysis** (`prosody.rs`, new, Estimated)
```rust
pub struct Nucleus { pub t_ms: u64, pub db: f32, pub f0_st: Option<f32>, pub voiced_ms: u32, pub prominence: f32 }
pub struct Prominence { pub nuclei: Vec<Nucleus>, pub expected_syllables: u32, pub peak_word: Option<usize>, pub aligned: bool, pub unavailable_reason: Option<String> }
/// Syllable nuclei (audio/syllables.rs), each scored by loudness, pitch and length relative to this take:
/// prominence = z(dB) + z(f0 semitones above the take median) + 0.5·z(voiced duration). The strongest nucleus is
/// mapped to a word by spreading each word's estimated syllables over the detected nuclei in order.
pub fn prominence(samples: &[f32], sample_rate: u32, words: &[&str]) -> Prominence
pub fn syllable_estimate(word: &str) -> u32   // vowel groups, silent final e, minimum 1
```
- **Alignment:** `aligned` is false when the detected nuclei differ from the expected syllables by more than 25%. The result then says: "Couldn't line up the beats this time. Listen and judge yourself."
- **Command:** `analyze_emphasis(attempt_id, sentence_id, target_index)` is cached through `activity_results` (kind `emphasis`).

**Result**
- **Per round:**
  - "Strongest beat: **say**" (Estimated);
  - a hit or miss mark against the target;
  - **Listen**.
- **When unaligned:** "Yes, I stressed it" / "Not quite" (Your note).
- **Totals:** "Estimated: 5 of 7 · Your judgement: 1 more". Estimates and self-judgements are kept apart (A-35).

**Records and achievements**
- Record `emphasis_hits` (estimated hits in one game).
- Achievement `emphasis-5`.

**Tests**
- Rust:
  - `prominence_picks_the_louder_higher_longer_syllable_in_synthetic_audio`: six 150 Hz bursts, the fourth 6 dB louder, a semitone higher and longer, gives peak 4;
  - `syllable_estimate_handles_silent_e_and_diphthongs` ("make" 1, "money" 2, "stole" 1, "didn't" 2);
  - `unaligned_when_nuclei_differ_by_more_than_a_quarter`.
- Vitest: `EmphasisResult.test.tsx`: `it("keeps estimated hits and your judgements apart")`.
- Manual: read 7 sentences with deliberate stress. **Observe:** most targets are found, and misses are plausible. Note the hit rate in Notes as a sanity check, not a release criterion.

---

## 10.7 Pace ladder

**Idea.** The same short answer slow, natural, then fast. This trains range and control, never "faster is better" (D-34).

**Plan**
- A familiar prompt.
- 3 rounds (`slow`, `natural`, `fast`), each 30 s, think 5 s.
- The live pace meter (8.8) is always on, and shows your usual band.

**Result** (`pace_ladder`, from `audio_measures`, Estimated)
- Rate per take, in syllables per second.
- The range (fast minus slow).
- "Three clearly different speeds" when slow < natural < fast with gaps of at least 0.4 syllables per second.
- Copy: "Range, not speed: being able to slow down on purpose is the skill."

**Records and achievements**
- Record `pace_range`.
- Achievement `pace-three-speeds`.

**Tests**
- Rust: `pace_ladder_needs_three_rates_and_reports_range`.
- Vitest: `PaceLadderResult.test.tsx`: `it("never labels a speed as better")`, using `expectNoScores` plus a check for the words "too fast" and "too slow".

---

## 10.8 Story spine and Story cubes

**Story spine** (`story_spine`)
- A 90 s story from `STORY_SEEDS` (60 seeds, appendix C).
- The spine cards are: "Once upon a time…" → "Every day…" → "But one day…" → "Because of that…" → "Because of that…" → "Until finally…" → "Ever since then…".
- **Live:** the current card is shown large and the next one small. Press **→** (or the button) to advance, which records a `card_advanced` mark. The optional auto-advance every 12 s is off by default.
- **Result:**
  - "Spine steps reached: 6 of 7", from the marks;
  - duration and words;
  - the self-check `concrete_detail` (Your note): "Did your story have one concrete detail (a name, a place, a sound)?"

**Story cubes** (`story_cubes`)
- **Setup:** roll 3–6 icon "cubes" (default 4) from `STORY_ICONS`. These are 60 lucide icons, each with 2–6 synonyms (Key: key, keys, lock, unlock…).
- Roll once more if you like. Think 15 s, speak 90 s.
- **Result** (`story_cubes`, Estimated):
  - icons used, matched by synonym stems in the transcript;
  - the self-check `used_all_icons` (Your note).

**Tests**
- Rust: `story_cubes_match_synonyms_once_per_icon`.
- Vitest:
  - `StorySpineLive.test.tsx`: `it("advances cards with the arrow key and records marks")`;
  - `story/plan.test.ts`: `it("rolls distinct icons per seed")`.

---

## 10.9 Elevator pitch

- **Plan:** one idea, typed or chosen from the prompts, in 3 rounds: 60 s, then 30 s, then 15 s. Each stops at its limit.
- **Result:**
  - words per round;
  - the self-check `kept_main_point` (Your note) for rounds 2 and 3: "Did the short version keep your main point?";
  - optional AI "Which words carried your point?" (preview, then Send), with quotes validated.
- **Tests:**
  - `pitch/plan.test.ts`: `it("uses 60, 30 and 15 seconds")`;
  - `PitchResult.test.tsx`: `it("asks whether each shorter version kept the point")`.

---

## 10.10 Steelman

- **Setup:**
  1. Pick an opinion prompt (tag `opinions`).
  2. Answer "Where do you stand?": For · Against · Not sure.
  3. The app gives you the other side ("Not sure" means you choose).
- **Rounds:**
  1. **Argue the other side**, 90 s.
  2. **Answer its strongest objection**, 60 s. The objection is from `FOLLOW_UPS[promptId]` when available, otherwise a general challenge.
- **Result:**
  - the self-check `fair_other_side` (Your note): "Would someone on that side say you put it fairly?";
  - the usual measures.
- **Tests:** `steelman/plan.test.ts`: `it("assigns the side you didn't choose")`.

---

## 10.11 Daily prompt

**Idea.** One prompt a day, like Wordle. Everyone using the same app version gets the same one, because it is deterministic by date, with no server. There is one official try, then a shareable grid with no audio and no text of your answer.

**Plan**
- **Prompt:** `DAILY_PROMPTS[(dayNumber(localDate) - DAILY_EPOCH) % DAILY_PROMPTS.length]`, a list of 365 prompts (appendix C).
- **Number:** "Daily #N", counting from `DAILY_EPOCH` (the release date of this feature).
- **Timing:** think 10 s, speak 60 s.
- **The official take** is the first take of that day's daily session. You can practise more takes, and they're labelled "practice".

**Result** (`daily_grid`, Estimated)
- Six 10-second windows, each classed as:
  - **flowing:** no hesitation candidate in the window and no long pause;
  - **hesitation:** a candidate's segment start falls in the window;
  - **pause:** a VAD pause of 1.5 s or more overlaps the window;
  - **silent:** no speech.
- Without a transcript, only pause and silent can be detected, and the grid says so.

**Share** (button "Copy share text", which writes to the clipboard and sends nothing anywhere):
```
ClearPractice Daily #123 · 1:00
🟩🟩🟨🟩⬜🟩
4 flowing · 1 hesitation · 1 pause
```
- The squares on screen have text labels, and the text line repeats the counts in words (accessibility).
- The share text includes no topic, so it can't reveal anything about you.

**On the Drills tab**
- A **Today's daily** card at the top shows the prompt and whether you've done it.
- A small 30-day strip of dailies shows done or not, with no streak count.

**Achievements:** `daily-7`, `daily-30`.

**Tests**
- Vitest:
  - `daily.test.ts`:
    - `it("gives the same prompt for the same date and a new one the next day")`;
    - `it("numbers dailies from the epoch")`;
  - `DailyResult.test.tsx`:
    - `it("copies share text with counts and no transcript words")`: the clipboard is mocked, and the copied text is checked for absence of every transcript token;
    - `it("marks only the first take as official")`.
- Rust: `daily_grid_classifies_windows`.

---

## 10.12 Gauntlet

- **Plan:** 5 rounds back to back, each a little harder:

  | Round | Task | Think | Speak |
  | --- | --- | --- | --- |
  | 1 | Familiar | 10 s | 30 s |
  | 2 | Unfamiliar | 10 s | 45 s |
  | 3 | For a named listener | 10 s | 60 s |
  | 4 | A follow-up about round 3 | 5 s | 45 s |
  | 5 | Steelman | 10 s | 60 s |

  - The prompts are drawn from the prompt pack with matching conditions, seeded.
  - The session prompt is "Gauntlet · 5 rounds", and each take's step carries its `promptId`.
- **Soft lock:** recommended after Spontaneity 3.
- **Result:**
  - the rounds completed (takes of at least 10 s);
  - the total speaking time;
  - per-round chips (duration, hesitation candidates).
- **Achievement:** `gauntlet-done`.
- **Tests:** `gauntlet/plan.test.ts`: `it("builds five rounds of increasing demand from the prompt pack")`.

---

## 10.13 Boss levels (scripted, offline)

**Idea.** Bigger challenges after level 3 of an area. Version 1 is fully offline, using written questions from the content pack. Version 2 (13.6) lets the AI partner play the other person, with voice.

**Bosses** (`src/content/bosses.ts`, appendix C)

| Boss | Rounds | Recommended after |
| --- | --- | --- |
| **Job interview (STAR)** | tell me about yourself (90 s) → 3 behavioural questions from `STAR_QUESTIONS` (each 120 s, with a STAR hint card: Situation · Task · Action · Result) | Structure 3 |
| **Skeptical Q&A** | your 60 s claim on a topic you choose → 3 skeptical questions (60 s each) | Spontaneity 3 |
| **Wedding toast** | 90 s toast with structure cards (who you are · a story · a wish · raise a glass) | Storytelling 3 |
| **Meeting update, interrupted** | a 60 s status update; at 40 s an interruption card appears ("Sorry, can I ask what the deadline is?"), the take stops, and a new round answers it in 30 s | Courage 3 |

- **Result:**
  - per round: the time spoken and measures;
  - a final self-check per boss (Your note), for example "Would you hire yourself?", "Did you stay calm under the questions?". Calm here is your own reading, never measured.
- **Achievements:** `boss-interview`, `boss-qa`, `boss-toast`, `boss-meeting`.
- **Tests:**
  - `bosses.test.ts`: `it("every boss has rounds with prompts and a recommended level")`;
  - `BossStudio.test.tsx`: `it("stops at the interruption and starts the answer round")`.

---

## 10.14 Drills tab and cards

**Screens:** Exercises → a new **Drills** tab (`?tab=drills`), shown after the Exercises tab.
```
┌ Today's daily · #123 ─────────────────────────────────────────────────┐
│ "Describe a smell that takes you back"     [Play]   ✓ done yesterday   │
└───────────────────────────────────────────────────────────────────────┘
Filter: (All) (Fluency) (Spontaneity) (Voice) (Stories) …     [Random drill]
┌ Just a Minute ─────────┐ ┌ Topic roulette ───────┐ ┌ Word bomb ──────────┐
│ ⏱ 2 min · Fluency       │ │ ⏱ 2 min · Spontaneity │ │ ⏱ 2 min · Vocabulary│
│ Speak 60 s without      │ │ Spin, think 10 s,     │ │ Weave in surprise   │
│ hesitating.             │ │ speak.                │ │ words.              │
│ Best: 52 clean seconds  │ │ Played 4 times        │ │ Recommended after   │
│               [Play]    │ │             [Play]    │ │ Vocabulary 2 · Try  │
└─────────────────────────┘ └───────────────────────┘ └─────────────────────┘
```

**Files**
- `src/features/drills/DrillsTab.tsx`.
- `src/features/drills/DrillCard.tsx`: `DrillCard({ drill, best, plays, recommendation, needsTranscript })`.
- When `needsTranscript` is true and local Whisper isn't set up, the card shows: "Full result needs local transcription. [Set it up]".
- **Random drill** picks a drill seeded by date + time, preferring one not played in 14 days.
- **Calm style:** no "Best" lines and no soft-lock text.
- **Ctrl+K action** "Play Just a Minute" (8.10).

**Tests**
- `DrillsTab.test.tsx`:
  - `it("filters by area")`;
  - `it("shows best and recommendation in playful style only")`;
  - `it("explains when a drill needs transcription")`;
  - `it("Random drill prefers one not played lately")`.

---

## 10.15 Drill content and tests

**Content files and their required counts** (appendix C, all in `src/content/`, each with `<name>.test.ts`):

| File | Required content |
| --- | --- |
| `drills.ts` | 13 drill definitions |
| `jam-topics.ts` | 120 topics |
| `roulette-topics.ts` | 8 categories × 20 topics |
| `word-bomb-words.ts` | 200 nouns with plurals |
| `emphasis-sentences.ts` | 20 sentences, each with 2–4 targets that change the meaning, and a one-line meaning per target |
| `story.ts` | 60 seeds and 60 icons with synonyms |
| `daily-prompts.ts` | 365 prompts |
| `bosses.ts` | 4 bosses |
| `star-questions.ts` | 30 questions |

**Every content test checks:**
- unique IDs;
- the counts above;
- length limits (topics ≤ 80 characters, prompts ≤ 160);
- no duplicates after normalising case and punctuation;
- `offending()` finds nothing;
- every icon name exists in lucide (import check).

Daily prompts additionally:
- no prompt repeats within 365 days;
- a balance of tags (no tag above 30%).
