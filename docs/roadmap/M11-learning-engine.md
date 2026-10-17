# M11: Learning engine

> **Goal.** Build proven learning methods into how the app picks and shows practice:
> - spaced re-answering;
> - difficulty that keeps you mostly succeeding;
> - interleaving;
> - feedback you choose when to see;
> - predict, then check;
> - a habit-reversal programme for fillers, with the "Catch it" game;
> - saying phrases aloud;
> - a 5-minute sprint on your weakest area.
>
> **What you'll see:**
> - Today suggests re-answers, and has a challenge dial and an optional warm-up drill.
> - Exercises gets a **Programmes** tab.
> - Phrases gets a **Say it** button.
> - Settings has "When to show measures".
>
> **Schema:** v20. **Effort:** 10–14 days.
>
> **Exit gate:**
> - All WPs are done.
> - The scheduler tests cover the new rules, with reasons visible.
> - A-35 covers predictions.
> - The filler programme can be completed end to end in the mock and on the desktop, with the system date changed.

| WP | Title | Effort |
| --- | --- | --- |
| 11.1 | Spaced re-answering | M |
| 11.2 | Challenge dial and difficulty tuning | M |
| 11.3 | Interleaving: warm-up drill and mixed sets | S |
| 11.4 | Feedback timing | S |
| 11.5 | Predict, then check | M |
| 11.6 | Filler programme and Catch it | L |
| 11.7 | Phrases: Say it | M |
| 11.8 | Weakest-area sprint | S |

**Schema v20**
```sql
-- Learning engine (M11). IDs and numbers only (A-30).
-- Your guesses before seeing a take's measures (11.5), Your note.
CREATE TABLE self_predictions (
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 kind TEXT NOT NULL CHECK(kind IN ('hesitations','pace')),
 predicted TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(attempt_id, kind)
) STRICT;
-- Guided programmes (11.6): one row per run, one per finished step.
CREATE TABLE programmes (
 id TEXT PRIMARY KEY,
 programme TEXT NOT NULL,
 week INTEGER NOT NULL DEFAULT 1 CHECK(week BETWEEN 1 AND 12),
 started_at_ms INTEGER NOT NULL,
 completed_at_ms INTEGER,
 stopped_at_ms INTEGER
) STRICT;
CREATE TABLE programme_steps (
 programme_id TEXT NOT NULL REFERENCES programmes(id),
 step_id TEXT NOT NULL,
 ref_id TEXT,
 done_at_ms INTEGER NOT NULL,
 PRIMARY KEY(programme_id, step_id)
) STRICT;
-- Catch it (11.6): when you pressed during playback, and how many matched.
CREATE TABLE catch_runs (
 id TEXT PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 presses TEXT NOT NULL DEFAULT '[]',
 caught INTEGER NOT NULL CHECK(caught >= 0),
 total INTEGER NOT NULL CHECK(total >= 0),
 created_at_ms INTEGER NOT NULL
) STRICT;
PRAGMA user_version=20;
```
**Purge.** `purge_take_rows` deletes `self_predictions` and `catch_runs`. Programmes are kept: they aren't tied to one take, and `ref_id` stops resolving after a purge.

**As built (17 Oct)**
- `programmes` also has `week_started_at_ms`: steps count from when the current week started (or was repeated), not from the start of the run.
- New native code: `storage/learning.rs` and `commands/learning.rs` (ten commands). Events `prediction` (5 XP, at most 5 a day), `programme_step` (10), `catch_run` (10) and `reanswer_skipped` (0) join the ledger; facts v5 add `FactTake.predictions`, `FactTake.catchRuns` and `PracticeFacts.programme`.
- Preferences gain `challengeBias`, `warmUp`, `measuresTiming`, `predictFirst` and `predictTipSeen`, each validated natively.
- The rules live in `src/lib/learning/` (`reanswer.ts`, `feedback.ts`, `predict.ts`, `catch-it.ts`, `programmes.ts`, `interleave.ts`) and the screens in `src/features/learning/`. The spec's separate test files are one `src/lib/learning/learning.test.ts` (23 tests) plus a test file per screen.

---

## 11.1 Spaced re-answering

**Goal.** Answer the same question again after 1, 7 and 30 days, then hear the difference. This draws on three research findings:
- spaced practice beats massed practice (Cepeda et al. 2006);
- retrieval strengthens memory (Roediger & Karpicke 2006);
- task repetition supports second-language fluency (blueprint §7, S5).

**Rules** (`src/lib/learning/reanswer.ts`)
```ts
export const REANSWER_DAYS = [1, 7, 30] as const;
export type Reanswer = { promptId: string; promptText: string; firstSessionId: string; firstAttemptId: string; firstDate: string;
  step: 1 | 7 | 30; dueDate: string; overdueDays: number };
/** Prompts you answered (any session with a take, not the baseline, not drills), whose next step is due today or earlier.
 *  A step counts as done when you answered the same prompt again on or after its due date; skipped steps don't return. */
export function dueReanswers(facts: PracticeFacts, events: PracticeEvent[], today: string): Reanswer[]   // most overdue first
```
- **Today shows one re-answer at most:** the most overdue.
- **Exercises → Prompts** gets a filter chip, "Due to answer again (3)".
- **Skipping** ("Not this one") records `practice_events` kind `reanswer_skipped`, with ref `"{promptId}:{step}"` and 0 XP.

**User flow**
1. **Today → This week** has a new row, "Answer again". For example: "Explain how you make coffee · you first answered 7 days ago." It has two buttons, **Answer again** and **Not this one**.
2. **The Studio opens** with that prompt and `?reanswer=<firstAttemptId>`. A note under the title says: "No need to remember your first answer; just answer it again."
3. **After the take**, a button **Compare with your first answer** opens `/compare?a=<first>&b=<new>` (A/B listen, 8.5).

**Front end**
- `src/features/learning/ReanswerCard.tsx`, used in `TodayPage` and in the Prompts filter.
- `StudioPage` reads `?reanswer` and shows the compare button once a take exists.

**Tests** (`reanswer.test.ts`)
- `it("schedules 1, 7 and 30 days after the first answer")`
- `it("counts a later answer on or after the due date as done")`
- `it("never returns a skipped step")`
- `it("ignores the baseline and drill sessions")`

`ReanswerCard.test.tsx`:
- `it("opens the studio and offers the comparison after a take")`

**As built (17 Oct)**
- A re-answer counts only Record and repeat sessions with a prompt from the pack or your own (not drills, not the baseline, not Phrase practice). The step due is the latest one whose date has come, so after a long gap you answer once for the 30-day step rather than three times.
- Today shows the most overdue re-answer as the last row of This week, skipping one whose prompt is already the week's new situation. Exercises → Prompts shows **Due to answer again (n)** whenever something is due; it lists the due prompts as the same rows, filtered by the other choices.
- The Studio note reads "Answering again: no need to remember your first answer; just answer it again." **Compare with your first answer** appears once this visit has a take, next to Return to Today (and also inside a sequence).
- The sample sessions in the browser preview now carry their prompt IDs, so the preview shows re-answers.

---

## 11.2 Challenge dial and difficulty tuning

**Goal.** Practise where you succeed most of the time but not always. The research figure is about 85% (Wilson et al. 2019); the app keeps it internal and shows counts, never percentages. You always choose.

**Screens.** The Today focus panel gets a segmented control under Session length: **Challenge: Easier · Just right · Harder**, saved as `challengeBias` (-1, 0, 1).

**Rules** (`scheduler.ts`)
```ts
/** From your last 10 sessions with an ease rating: manageable = 3 or more. */
export function recentSuccess(facts: PracticeFacts): { manageable: number; rated: number }
export function tuning(facts, stage: Stage, bias: -1 | 0 | 1): Suggestion | null
```
- **Mostly easy:** at least 9 of 10 rated sessions manageable, at least 6 rated, and the bias isn't Easier. Suggest one harder demand:
  - "Things have felt manageable lately (9 of 10). Try one harder demand today: less preparation time."
  - The demands are raised one at a time in this order: preparation → topic novelty → audience → length → follow-up (§7 "Change one demand at a time").
  - Never "speak faster".
- **Often hard:** 7 or fewer of 10 manageable. Suggest keeping or easing:
  - "Several recent sessions felt hard (4 of 10). Keep the same demand, or choose Easier."
- **How the bias changes prompt choice** (`stagePrompt` and the Today plan):

  | Bias | Prompt choice |
  | --- | --- |
  | Easier | familiar prompts with 30 s or more of preparation |
  | Harder | half the preparation (minimum 0), unfamiliar prompts first |

- **The bias never changes stage on its own.** Stage moves stay your choice (4.18).

**Tests** (`scheduler.test.ts`)
- `it("suggests one harder demand after nine manageable sessions of ten")`
- `it("suggests keeping or easing after four hard sessions of ten")`
- `it("raises demands in the documented order and never asks for faster speech")`
- `it("Harder halves preparation in the chosen prompt")`

`TodayPage.test.tsx`:
- `it("saves the challenge dial")`

**As built (17 Oct)**
- The dial is a row of three radio options under Session length, with one line saying what the choice does and that the stage only changes when you choose. Changing it asks for the plan again.
- Harder halves the preparation of the week's task: the plan carries `weekly.newSituation.preparationSeconds`, Try it opens the Studio with `?prepSeconds=`, and the Studio can only lower a prompt's own time (`withPreparation`). The take records the time you had. The task's reason adds what the dial changed.
- The tuning suggestion needs at least six rated sessions among your last ten and leads the plan's suggestions. Easier still lets the "keep or ease" suggestion show; it never shows "harder" while Easier is chosen.

---

## 11.3 Interleaving: warm-up drill and mixed sets

**Goal.** Mix kinds of practice instead of blocking them. Interleaving helps most when the kinds are similar enough to confuse (Brunmair & Richter 2019).

**Rules**
- **Warm-up drill.** A preference `warmUp: boolean` (default false), set in Settings → Practice → **Start with a 2-minute warm-up game**.
  - When it is on, `buildTodayPlan` adds step 0, a drill chosen by `pickWarmUp(facts, areas, today)`.
  - The choice prefers the area with the least practice (9.15), and a drill not played in 7 days.
  - `PLAN_STEPS` stays as it is. The warm-up comes first and adds 2 minutes.
- **Mixed set.** Drills tab → **Mixed set** button: three different short drills in a row (JAM, roulette, word bomb, emphasis…), seeded by date. It reuses the sequence machinery (`startSequence` with activity steps; `PlanStep` gains an optional `drillId`).

**Tests**
- `today-plan.test.ts`:
  - `it("adds a warm-up drill only when enabled")`
  - `it("prefers the least-practised area for the warm-up")`
- `sequence.test.tsx`:
  - `it("walks a mixed set of three drills")`

**As built (17 Oct)**
- The warm-up is picked in the desktop client only when the setting is on, so Today's start-up doesn't load the game engine for everyone; the browser preview's warm-up is always Just a Minute.
- A sequence can hold drill steps (`drillId`) and particular pages (`to`); the drill studio shows the step bar with `?seq=1`, and a sequence has its own title ("Mixed set", "Voice sprint"). Finishing one opens Practice complete like today's practice.
- The mixed set draws three different drills from the seven short ones (Just a Minute, roulette, word bomb, emphasis, story spine, story cubes, pace ladder), the same three all day.

---

## 11.4 Feedback timing

**Goal.** You choose when you see measures. Learners who chose when to get feedback learned better than those who got it every time (Chiviacowsky & Wulf 2002).

**Settings.** Settings → Practice → **When to show measures** (radio):
- **After every take** (as now).
- **When I ask:** the Flow and Words sections are folded behind **Show measures**. "What went well" and the self-check stay visible.
- **Fewer as I improve:** measures show for your first 5 takes with a new focus, and while your Fluency level is below 3. After that they are folded.

**Front end**
- `src/lib/learning/feedback.ts` has `shouldFoldMeasures(pref, ctx: { takesWithFocus: number; fluencyLevel: number }): boolean`. `TakeSummary` uses it.

**Tests** (`feedback.test.ts`)
- `it("folds only in the two optional modes")`
- `it("fades after five takes with the same focus and from Fluency 3")`

`TakeSummary.test.tsx`:
- `it("shows measures on request")`

**As built (17 Oct)**
- The setting is in Settings → Practice → **How you practise**, together with the warm-up switch and Guess before you see the measures.
- "Takes with a new focus" counts your takes in sessions with the same focus as this take's session, up to and including it. Fluency comes from the levels you have reached, so Fewer as I improve works in Calm style too.
- Folded measures show one line ("Measures show when you ask." or "Measures fold as you improve.") with **Show measures**.

---

## 11.5 Predict, then check

**Goal.** Train self-awareness: guess first, then look. Accurate self-judgement supports learning (Dunlosky & Rawson 2012).

**Rules**
- **Preference** `predictFirst` (default off). After 10 transcribed takes, a tip in the take summary offers it once.
- **After a take is transcribed, before its summary,** a card asks two questions:
  - "How many hesitations do you think you had?" **0–1 · 2–4 · 5 or more**
  - "Your pace compared with usual?" **Slower · About usual · Faster**
- **The actual buckets** come from the take:
  - hesitations from the filler candidates (confirmed, if reviewed);
  - pace against your median, where within ±7% counts as "About usual" (Estimated).
- **Reveal** shows both side by side: "You guessed 2–4 · Estimated: 3 hesitation candidates". The guess is labelled Your note and the take's value Estimated (A-35).
- **XP:** a `prediction` event, 5 XP, at most 5 a day.
- **Progress → Profile** gets a **Self-awareness** row: "Your guesses matched 6 of your last 10 takes", with a 3×3 grid of guessed against actual for hesitations.

**Native**
- `storage/learning.rs` has `set_prediction(attempt_id, kind, predicted)` and `list_predictions(from: Option<String>)`.
- Commands are in `commands/learning.rs`.
- Facts gain `FactTake.predictions: { hesitations?: string; pace?: string }`.

**Front end**
- `src/features/learning/PredictCard.tsx`. `TakeSummary` shows it first when `predictFirst` is on and the take has no prediction yet. A **Skip** button shows the summary straight away.

**Tests**
- Rust: `predictions_are_stored_once_per_kind_and_purged_with_the_take`.

`PredictCard.test.tsx`:
- `it("hides measures until reveal")`
- `it("labels the guess Your note and the value Estimated")`
- `it("Skip shows the summary without saving")`

`profile.test.ts`:
- `it("counts matches over the last ten predictions")`

**As built (17 Oct)**
- The card is titled "Before you look: guess first". Either question may be answered; Reveal saves what you chose (the first guess for a take stands) and earns the `prediction` event once per take. Skip is remembered for this visit only.
- The reveal sits above What went well, one row per guess: "you guessed …" with Your note, then the take's value with Estimated, and "matched" when they agree. Never a percentage.
- Hesitations count confirmed fillers once every candidate in the take is decided, else the candidates; "About usual" is within 7% of the median pace of your other takes.
- The tip appears under the summary of the latest take after ten transcribed takes, with Turn it on and No thanks; either answer stops it.
- Self-awareness is a panel under the speech profile once a guess can be compared.

---

## 11.6 Filler programme and Catch it

**Goal.** A 4-week guided programme based on habit reversal:
- **awareness**, then a **competing response** (a silent pause), then **generalising**, then the **real world**;
- studied specifically for filled pauses in public speaking (Mancuso & Miltenberger 2016; Azrin & Nunn 1973).

**Content** (`src/content/programmes.ts`)
```ts
export type ProgrammeStep = { id: string; week: number; title: string; how: string; detect: StepDetector | null /* null = you tick it */; link?: string };
export type ProgrammeDef = { id: "fillers-4w"; title: string; summary: string; weeks: { week: number; theme: string; steps: ProgrammeStep[] }[] };
export const PROGRAMMES: ProgrammeDef[];   // version 1: the filler programme only; appendix C lists every step
```

The filler programme:

| Week | Theme | Steps |
| --- | --- | --- |
| 1 | Notice | (a) Catch it on 3 of your takes · (b) review the candidates in 3 takes · (c) write when fillers come most (a note) |
| 2 | Pause instead | (a) three 60 s familiar answers with the focus "Pause instead of um" · (b) 2 Just a Minute rounds · (c) Catch it on a new take |
| 3 | Take it further | (a) 3 unfamiliar questions with the same focus · (b) 1 topic roulette · (c) A/B listen: a week-1 take against a week-3 take |
| 4 | Real conversations | (a) 2 real conversations with the focus in mind (reflections) · (b) an after-action note (12.3, or a reflection until M12) · (c) answer week 1's first prompt again and compare |

**Rules**
- **Steps complete automatically** when their detector sees matching facts since the week started (for example, "reviewed candidates in 3 takes since Monday"). You can also tick any step by hand.
- **A week advances** when 3 of its steps are done or 7 days have passed. You can move on or repeat a week any time, and nothing is ever "failed". The copy says: "Take your time; the programme waits for you."
- **Focus.** During the programme, the session focus defaults to the week's focus, and you can change it.
- **XP:** each step is a `programme_step` event (10 XP).

**Catch it** (`src/features/learning/CatchIt.tsx`)
1. **Pick a take** you've reviewed, with at least 3 confirmed fillers.
2. **Play it** with the transcript hidden. Press **F**, or the big **Caught one** button, whenever you hear a filler. A soft click confirms each press, with no right or wrong shown during play.
3. **See the result** afterwards: "You caught 4 of 6 (Estimated)". Timings are approximate, so a press counts when it falls inside the segment that contains a confirmed filler, and each filler is matched at most once. Then a timeline shows your presses against the fillers, with a **Listen** button for each.
4. **Saved** in `catch_runs`, and worth a `catch_run` event (10 XP).

**Screens.** Exercises → **Programmes** tab:
```
┌ Fewer fillers, in four weeks ─────────────────────── Week 2 of 4 · Pause instead ┐
│ ✓ Three 60-second answers with the focus "Pause instead of um"   (auto, 3 of 3)  │
│ ○ Two Just a Minute rounds                                    1 of 2   [Play]     │
│ ○ Catch it on a new take                                              [Start]    │
│ [Repeat this week]  [Move on]  [Stop the programme]                              │
└──────────────────────────────────────────────────────────────────────────────────┘
```
While a programme runs, a compact card in the Today aside shows the current week and the next step.

**Native**
- `storage/learning.rs` has `start_programme`, `programme_state`, `complete_programme_step`, `set_programme_week`, `stop_programme`, and `save_catch_run(attempt_id, presses, caught, total)`.
- **Validation:**
  - `caught ≤ total ≤ 200`;
  - at most 500 presses;
  - presses within the take's duration.
- Facts gain `programme` (active run, week, done step IDs) and `FactTake.catchRuns`.

**Tests**
- `programmes.test.ts`:
  - `it("detects automatic steps from facts since the week started")`
  - `it("advances after three steps or seven days and never fails")`
- `catch-it.test.ts`:
  - `it("matches each press to at most one filler inside its segment")`
  - `it("reports caught of total")`

`CatchIt.test.tsx`:
- `it("hides the transcript while playing and shows the timeline after")`
- `it("F records a press only while playing")`

Rust:
- `catch_runs_are_validated_and_purged_with_the_take`
- `programme_steps_are_recorded_once`

Manual:
1. Run week 1 with the system date moved forward 7 days. **Observe:** the week advances, and the Today card follows.

**As built (17 Oct)**
- Weeks never move on by themselves, so a week you had no time for is never skipped: once three steps are done or seven days have passed, the card says why and **Move on to week n** becomes the main button. Moving on is always allowed. The manual check is therefore: with the date moved forward 7 days, the card offers Move on with "A week has passed…", and Today's card follows.
- Only steps done since the week started (or was repeated) count. Repeat this week restarts its clock and its steps; redoing a step updates its date and earns nothing more (`complete_programme_step` upserts).
- Steps detected from your practice are recorded by `useProgramme` wherever the programme is shown (the tab or Today's card). Any step can be marked done by hand.
- Step IDs follow appendix C.8 (`w1-catch-3` … `w4-reanswer`).
- Week 1 detectors: Catch it runs on 3 takes; transcript reviews (the `transcript_reviewed` event) since the week started. Week 2: three different sessions with the pause focus and a minute or more of speech; two Just a Minute rounds; Catch it on a take from this week. Week 3: three unfamiliar-prompt sessions with the focus; one roulette round. Week 4: two reflections, one with a next focus. The other steps are marked by hand.
- Catch it plays the take with the app's audio player (no waveform, so no markers give fillers away). F or Caught one counts only while it plays, with a soft click. The run is saved, and earns its points, only when you heard at least 80% of the take or it played to the end. The result lists each filler with Caught or Not caught this time and Listen.
- In the browser preview Catch it says it works with your own takes in the desktop app.

---

## 11.7 Phrases: Say it

**Goal.** Say phrases aloud during review. Producing words aloud improves memory (the production effect, MacLeod et al. 2010), and the app can spot the phrase in what you said (8.2).

**User flow**
1. **Phrases → a due card → Say it.** An inline compact recorder opens under the card, with the hint "Say a sentence of your own using *I lost track of time*". Takes are 20 s at most.
2. **The take is saved** in today's **Phrase practice** session:
   - one session per day;
   - exercise type `phrase_say_it` (exercise `ex-phrase-say-it`; add the type to `KNOWN`, `ExerciseType` and `EXERCISE_TYPE_INFO` in this WP);
   - found again through facts, or created on the first take.
3. **The take is transcribed automatically** (local). The card then shows "Phrase spotted in your sentence (Estimated)", or "Not found; you can still rate it", with **Listen**.
4. **Rate as usual:** Again, Hard or Good. Your rating stays your choice and never comes from the spotting.

**Front end**
- `src/features/learning/PhraseSayIt.tsx` uses `RecorderPanel` in compact mode. Add a `compact` prop to 7.9: a smaller clock, no microphone row, and a link "Change microphone".
- `PhrasesPage` adds the **Say it** button on due cards.

**Tests**

`PhraseSayIt.test.tsx`:
- `it("records into today's phrase practice session")`
- `it("shows spotted or not found after transcription")`
- `it("never rates for you")`

Rust:
- `phrase_say_it_sessions_reuse_today`, covered by 7.3's activity snapshot tests plus a facts query.

**As built (17 Oct)**
- **Say it** appears on a card once you reveal it, above the ratings. The compact recorder hides the microphone picker (a Change microphone link goes to Settings → Audio) and stops at 20 seconds.
- Today's Phrase practice session is found in facts, or a new ID is kept for the rest of the day in this visit, so every card of a review shares one session. Its prompt is generic ("Say a sentence of your own using a saved phrase").
- With automatic transcription on, the take is transcribed locally right away; otherwise a Transcribe button, or the reason it can't. The phrase is spotted by the existing phrase matching (8.2), so a different form can be missed, as the card says.

---

## 11.8 Weakest-area sprint

**Goal.** Like Keybr's focus on your weakest letters: a 5-minute set aimed at the area with the least practice.

**Rules**
- `weakestArea(areas, facts)`: the lowest current level, with ties broken by the fewest sessions in the area over 30 days.
- The sprint has 2 or 3 steps, taken from `AREA_PRACTICE[area][nextLevel]` (appendix A). For example, Voice 2 is an imitation session on endings, then the emphasis game.

**Entry points**
- The suggestion card on Today (9.15).
- The area sheet → **5-minute sprint**.
- Ctrl+K "Sprint on my weakest area".

**Tests**

`sprint.test.ts`:
- `it("picks the lowest level, then the least practised")`
- `it("builds two or three steps for the next level")`

`TodayPage.test.tsx`:
- `it("starts the sprint as a sequence")`

**As built (17 Oct)**
- Entry points: **5-minute sprint** under the suggestion in Journey this week (for that area), in an area sheet (toward its next level), and Ctrl+K "Sprint on my weakest area", which opens `/sprint` to pick the area (`?area=` names one).
- Steps come from the next level's practice links that open a drill or a Studio exercise, then that area's short drills; an area with neither (Courage) rehearses speaking on the spot with topic roulette and Just a Minute.
- Ctrl+K also gained "Play Catch it".
