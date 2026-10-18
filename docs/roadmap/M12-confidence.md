# M12: Confidence pack

> **Goal:** help with the nerves around speaking, using methods with good evidence:
> - **Exposure ladder:** graded steps with discomfort ratings from 0 to 10 (cognitive behavioural therapy).
> - **Pre-talk routine (3 minutes):** cyclic sighing, voice warm-ups, saying "I'm excited", a worry dump, and self-talk using your name.
> - **After-action review** after real talks.
> - **Best-moments reel:** your own best sentences of the week.
>
> All self-reports are labelled **Your note**. None is ever placed next to an audio measure as its judgement (A-35). Power poses are deliberately left out: the original effect didn't replicate (Ranehill et al. 2015).
>
> **What you'll see:** a new **Confidence** page in the sidebar, a **Before a real talk** entry on Today, liked sentences in transcripts, and the weekly reel.
>
> **Schema:** v21. **Effort:** 8–11 days.
>
> **Exit gate:**
> - every WP is done;
> - A-35 covers the ladder, the routine and the AAR;
> - the routine works fully offline;
> - the reel plays segments without manufactured timestamps (segment times only).

| WP | Title | Effort |
| --- | --- | --- |
| 12.1 | Confidence page and navigation | S |
| 12.2 | Exposure ladder | L |
| 12.3 | Pre-talk routine | M |
| 12.4 | After-action review | S |
| 12.5 | Liked sentences and the best-moments reel | M |

**Schema v21**
```sql
-- Confidence pack (M12). Your own ratings and notes (Your note). User content,
-- not tied to sessions: soft-deleted, kept in backups, not in session exports.
CREATE TABLE exposure_steps (
 id TEXT PRIMARY KEY,
 position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 30),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 160),
 template_id TEXT,
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE exposure_attempts (
 id TEXT PRIMARY KEY,
 step_id TEXT NOT NULL REFERENCES exposure_steps(id),
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 before_rating INTEGER CHECK(before_rating BETWEEN 0 AND 10),
 after_rating INTEGER CHECK(after_rating BETWEEN 0 AND 10),
 done INTEGER NOT NULL CHECK(done IN (0,1)),
 note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 1000),
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
-- Sentences you liked in your own takes (12.5): a revision and its segment index.
CREATE TABLE segment_marks (
 revision_id TEXT NOT NULL REFERENCES transcript_revisions(id),
 segment INTEGER NOT NULL CHECK(segment >= 0),
 kind TEXT NOT NULL CHECK(kind IN ('liked')),
 created_at_ms INTEGER NOT NULL,
 PRIMARY KEY(revision_id, segment, kind)
) STRICT;
-- Pre-talk routine runs (12.3): which steps you did. Worry-dump text is never stored unless you keep it.
CREATE TABLE routine_runs (
 id TEXT PRIMARY KEY,
 local_date TEXT NOT NULL,
 steps TEXT NOT NULL DEFAULT '[]',
 kept_note TEXT CHECK(length(kept_note) <= 4000),
 event_id TEXT,
 created_at_ms INTEGER NOT NULL
) STRICT;
-- After-action reviews (12.4) share the reflection table.
ALTER TABLE transfer_reviews ADD COLUMN kind TEXT NOT NULL DEFAULT 'reflection' CHECK(kind IN ('reflection','aar'));
ALTER TABLE transfer_reviews ADD COLUMN extra TEXT NOT NULL DEFAULT '{}';
PRAGMA user_version=21;
```

**Two exceptions to the engagement-table rules** (README §7.2 rule 3). These tables are your own written content, not engagement ledgers. The rule "IDs and numbers only" is for ledgers:
- `exposure_attempts.note`;
- `routine_runs.kept_note`.

Both behave like the existing reflection text: they are kept in backups and searchable.

**Purge:**
- `segment_marks` are deleted with their revision in `purge_take_rows`, next to the annotations.
- Exposure and routine rows are user content. Each has its own delete, a soft delete with Undo.

**As built (18 Oct)**
- An attempt has an `outcome` instead of `done`: `planned` (a before rating only), `yes`, `partly` or `not_this_time`. Partly is kept apart from Yes, and facts carry both `outcome` and `done` (yes or partly). A plan is completed by updating the same attempt, so its before rating stays with it.
- New native code: `storage/confidence.rs` and `commands/confidence.rs` (11 commands); events `exposure_step` (30), `routine` (10) and `after_action` (20); facts v6 add `exposure` (every step, deleted ones flagged, with its attempts) and each reflection's `kind`; preferences gain `displayName` (up to 40 characters, one line).
- Search covers sessions only, as it did for reflections, so ladder notes and kept routine notes are kept in backups but not searchable (the spec said "searchable").
- Attempts and routine runs are deleted softly: each step has a folded Attempts list with Remove, and Confidence lists Notes you kept with Remove. Both ask "Remove…?" first instead of offering Undo. `routine_runs` gained `deleted_at_ms` and `delete_routine_run` for this; effort earned stays (A-28).
- Also from appendix B, now that their data exists: achievements `ladder-3`, `stretch` and `aar`, the quest `ladder-1`, and the Courage criteria with `exposure`. Three M11 achievements that were missing were added at the same time: `prediction-10`, `say-it-10` and `catch-it`. The "upgrade" activity now says it arrives with the conversation partner (13.10), not the learning engine.

---

## 12.1 Confidence page and navigation

**Navigation:**
- `nav.ts` gets the item `{ id: "confidence", label: "Confidence", to: "/confidence", icon: HeartHandshake }`, placed after Phrases.
- It is shown in **both** styles, because it isn't part of the game layer.
- The route is `confidence` (lazy) and the crumb is "Confidence".

**Screen:**
```
┌ Confidence ──────────────────────────────────────────────────────────────┐
│ Speaking nerves are common and they ease with gradual practice.          │
├ Your ladder ─────────────────────────────── [Edit ladder] ───────────────┤
│ 1 Record alone and listen back              done 3× · discomfort 6 → 2   │
│ 2 Send a voice message to a friend          done 1× · 7 → 4              │
│ 3 Ask one question in a team meeting        next     [I did it] [Plan]   │
│ …                                                                         │
│ [chart: before/after discomfort per attempt, by step]                     │
├ Before a real talk ──────────────────────────────────────────────────────┤
│ A 3-minute routine: breathe, warm up, reframe, unload, encourage. [Start]│
├ After a real talk ───────────────────────────────────────────────────────┤
│ What did you plan, what happened, why, what next time?   [Write a review]│
├ Your best moments this week ─────────────────────────────────────────────┤
│ 3 sentences from your takes  ▶ Play the reel                              │
└──────────────────────────────────────────────────────────────────────────┘
```

**Today:** the This week list gets a row, "Before a real talk? Run the 3-minute routine", linking to `/confidence/routine`.

**Tests** (`ConfidencePage.test.tsx`):
- `it("shows ladder, routine, review and reel sections")`
- `it("is in the sidebar in calm style too")`

**As built (18 Oct)**
- The page has two columns on wide windows: the ladder and the best moments on the left; Before a real talk and After a real talk on the right. After a real talk opens the after-action form on Progress → Real conversations (`?view=real&form=aar`), where reflections live.
- "Is in the sidebar in calm style too" is an assertion in A-27 (`a26-a27-game-layer.test.tsx`).
- Today's This week list has the row "Before a real talk?" with Start the routine.

---

## 12.2 Exposure ladder

**Goal:** graded exposure, step by step from easy to hard, with discomfort rated before and after each attempt. This has strong evidence for public-speaking fear (Ebrahimi et al. 2019). Watching your own discomfort fall over repeated attempts is the motivating part.

**User flow:**
1. **Build your ladder.** On the first visit, **Build your ladder** offers templates from `src/content/exposure-templates.ts` (appendix C): Meetings, Social situations, Presentations, Phone calls.
   - Pick one, then edit, reorder (drag, or Move up and Move down buttons for keyboard users) and add steps. Up to 30 steps.
   - Example, Meetings:
     1. Record yourself alone and listen back.
     2. Send a voice message to a friend.
     3. Say good morning to a colleague and ask about their weekend.
     4. Ask one question in a team meeting.
     5. Give a one-minute update in a meeting.
     6. Disagree politely with one point.
     7. Present for five minutes.
     8. Run a meeting.
2. **Rate before.** On a step, **Plan** (optional) asks "How uncomfortable do you expect this to feel?" (0–10 slider) and saves the before rating.
3. **Rate after.** After doing the step in real life, **I did it** asks:
   - the after rating (0–10);
   - "Did you do it?" (Yes / Partly / Not this time; "Not this time" is fine and is stored with `done=0`);
   - an optional note.
4. **Next step.** A step whose last two attempts both have an after rating of 3 or less shows "This one feels manageable now. Ready for the next step?" The next step is highlighted. Nothing locks.

**Screen details:**
- The 0–10 scale (`DiscomfortScale.tsx`):
  - an 11-step Radix `Slider`, with anchors 0 "None", 5 "Noticeable", 10 "Very strong";
  - the value is shown as "6 of 10" (never "6/10", A-26), with the label "Your note".
- The chart (Recharts):
  - per step, before and after points over attempts, with the line "Before" dashed and "After" solid;
  - the y-axis is 0–10 and labelled "Discomfort (your rating)";
  - there is an sr-only table.
- Copy: never call the user "anxious". The scale is "discomfort", and the page explains: "Rating it helps you see it change. It's your own reading, never measured from your voice."

**Native** (`storage/confidence.rs`, `commands/confidence.rs`):
- `list_exposure_steps`;
- `save_exposure_steps(steps: Vec<StepInput>)`, which saves the whole ordered list (insert, update, soft delete);
- `add_exposure_attempt(input)`, `update_exposure_attempt`, `delete_exposure_attempt` and `list_exposure_attempts(step_id: Option)`.
- XP: an `exposure_step` event (30 XP) when `done=1` (ref = attempt ID).
- Facts (factsVersion 4): `exposure: { stepId, position, attempts: [{ date, before, after, done }] }[]`. These feed Courage level 3 and level 4 (appendix A: "a step you rated 6 or more before, done").

**IPC:** `ExposureStep`, `ExposureAttempt` and `ExposureInput` schemas; the methods above; keys `["engagement", "exposure"]`. The mock includes a sample ladder.

**Tests:**
- Rust:
  - `ladder_order_is_saved_and_soft_deletes_keep_attempts`
  - `ratings_are_0_to_10_and_notes_limited`
  - `done_attempts_award_xp_once`
- `ExposureLadder.test.tsx`:
  - `it("builds a ladder from a template and reorders by keyboard")`
  - `it("records before and after ratings as your note")`
  - `it("suggests the next step after two calm attempts and locks nothing")`
- `DiscomfortScale.test.tsx`: `it("reads as N of 10, never N/10")`.
- A-35: `a35-self-reports.test.tsx` adds the ladder chart and rows.

**As built (18 Oct)**
- Reordering is by Move up and Move down buttons (keyboard and pointer); there is no drag.
- **I did it** completes an open plan (showing "You expected N of 10 beforehand"); without a plan it asks for both ratings. It also asks the day (the last week) and an optional note.
- The rules are in `src/lib/confidence/ladder.ts`: a step is manageable when its last two attempts with an after rating are 3 or less; the highlighted next step is the first step after a manageable one that isn't manageable itself.
- Each row reads "done 3× · discomfort 7 → 1" (first rating before, latest after). The ladder has one Your note label for all its ratings, and the chart shows one step at a time with a step picker and a table for screen readers.
- The preview's mock has a sample Meetings ladder with four attempts. `DiscomfortScale.test.tsx` is part of `ExposureLadder.test.tsx`.

---

## 12.3 Pre-talk routine

**Goal:** a calm, 3-minute routine before a real talk or interview. Every step can be skipped, and it works offline.

**Steps** (`src/content/routine.ts`):

| # | Step | Time | How | Source |
| --- | --- | --- | --- | --- |
| 1 | **Cyclic sighing** | 60 s | Breathing circle: inhale through the nose, a second short inhale, then a long, slow exhale through the mouth. About 5 rounds. | Balban et al. 2023 |
| 2 | **Voice warm-up** | 45 s | Lip trills (15 s), sirens low to high (15 s), one tongue twister said slowly, then normally (15 s). Optional quick recording to hear your voice. | common voice practice |
| 3 | **Reframe** | 15 s | Say out loud: "I'm excited." The screen explains that the body's arousal can be read as excitement. | Brooks 2014 |
| 4 | **Unload** | 60 s | Write any worries in a box for one minute. By default the text is discarded at the end; "Keep this note" stores it in `routine_runs.kept_note`. | Ramirez & Beilock 2011 |
| 5 | **Encourage** | 15 s | Say: "You've got this, {name}. You've prepared." Name-based self-talk. Uses `displayName` from preferences, or "you" without a name; ask for the name once. | Kross et al. 2014 |

**Screen:** route `/confidence/routine` (lazy), full width, large type.
- **Layout:** one step at a time, with a progress row of 5 dots, and **Skip** and **Next** buttons.
- **Breathing circle** (`BreathingCircle.tsx`):
  - an SVG circle that grows on inhale and shrinks on exhale, with a text cue ("Inhale… second inhale… long exhale");
  - under reduced motion, the circle stays static and only the text cues change;
  - the timings are 2 s, 1 s and 6 s.
- **Unload box:** a `Textarea` with a 60 s countdown. At the end it shows "Discard" (default) or "Keep this note".
- **The end:** "You're ready. Good luck." It links to the event's page when the routine was opened from an event (14.2).

**Native:** `save_routine_run({ steps, keptNote, eventId })` and `list_routine_runs`. XP: a `routine` event (10 XP, ref = run ID).

**Preferences:** `displayName` (README §6.6), edited in Settings → Practice → "Name for encouragement" and asked once in the routine.

**Tests** (`RoutinePage.test.tsx`):
- `it("walks five steps and allows skipping any")`
- `it("discards the worry text unless you keep it")`: checks that `saveRoutineRun` gets `keptNote: null`.
- `it("uses your name in the encouragement or 'you' without one")`
- `it("breathing cues are text-only under reduced motion")`

Manual: run the routine with the network off and Narrator on. **Observe:** the cues are read once per phase, not every second.

**As built (18 Oct)**
- The voice warm-up has no recording: the routine stays offline and adds nothing to your history. The tongue twister changes daily (ten in `src/content/routine.ts`).
- Breathing starts with **Start breathing** and runs five rounds of 2 s, 1 s and 6 s; the step's Next and Skip work at any time.
- The unload minute starts when the step opens. Discard is the default; the text is cleared when the routine finishes unless you chose Keep this note.
- The name is asked on the first routine only (when no run is saved yet), and can be changed in Settings → Practice → How you practise → Name for encouragement. Without a name the line is "You've got this. You've prepared."
- A routine where every step was skipped saves nothing. The end page also links to the after-action review.

---

## 12.4 After-action review

**Goal:** the US Army's four-question debrief after any real talk, in plain words. It is a reflection kind, so it counts toward Courage and feeds transfer.

**Form** (`AfterActionForm.tsx`; the entry points are the Confidence page, the event page (14.2) and Progress → Real conversations → **Add after-action review**):
1. What did you plan to do?
2. What actually happened?
3. Why was there a difference, if any?
4. What will you do next time?
5. Optional:
   - "What did the listener understand?" (their words, kept apart);
   - flow (9.16);
   - kind tags.

**Native:**
- `add_transfer_review` accepts `kind: "aar"` and `extra: { planned, happened, why, nextTime }`, each 0–2,000 characters.
- `situation` stays required: for an AAR it is the talk's title.
- XP: an `after_action` event (20 XP) in addition to `transfer_review`, because they are separate kinds.

**UI:** the Real conversations list shows AARs with a small "After-action" badge and the four answers.

**Tests:**
- Rust: `aar_reviews_store_extra_fields_and_award_both_events`.
- Vitest: `AfterActionForm.test.tsx` `it("saves the four answers and the listener's words separately")`.

**As built (18 Oct)**
- The four answers are required to be non-empty only as a whole: at least one must be answered. An after-action review's "What will you do next time?" counts as a next focus for levels and the filler programme's week 4.
- Progress → Real conversations has a Reflection / After-action review switch; the list shows an After-action badge and the four answers, with Your note.

---

## 12.5 Liked sentences and the best-moments reel

**Goal:** seeing yourself succeed builds confidence (video self-modelling; Dowrick 1999; self-efficacy, Bandura 1977). Each week the app offers your three best sentences to replay. The picks are rule-based and transparent, and the sentences you marked yourself come first.

**Liked sentences:**
- In the transcript view (`Transcript.tsx`, `TakeTranscript.tsx`), each segment gets a **♡ Like** toggle, visible on hover and focus and always visible on touch.
- It stores `segment_marks(revision_id, segment, 'liked')`.
- Markers: `liked` (8.4).
- Native: `set_segment_mark(revision_id, segment, liked: bool)` and `list_segment_marks(attempt_id)`.

**Reel rules** (`storage/confidence.rs` `best_moments(week_start) -> Vec<Moment>`):
- **Candidates:** segments from takes in the week (not trashed) whose current revision has timings.
- **Order:**
  1. Segments you liked.
  2. Then segments with 8–25 words, no filler candidate in the segment, no mid-clause pause next to it, and not starting with "and" or "so". Among these, longer runs come first; ties go to the more recent take.
- **Limit:** at most 3, from at least 2 different takes when possible.
- **Playback:** each moment is the segment's start to end time from the stored segment timings. There are no manufactured word times, consistent with §11.

**Screen:** Confidence → **Your best moments this week** and Journey (Playful):
```
▶ Play the reel (0:24)
1. "The first thing I do is open the window, because…"   ♡ you liked this   [Listen] [Open take]
2. "In the end, I realised the map was upside down."     picked: complete sentence, no hesitation
3. …
Picked by simple rules: complete sentences without hesitation candidates; sentences you liked come first.
```
**Play the reel** plays the segments back to back. The current sentence's text is highlighted, and each sentence has a text alternative.

**Tests:**
- Rust:
  - `best_moments_prefer_liked_then_rule_matches_and_use_segment_times_only`
  - `best_moments_skip_trashed_takes_and_untimed_revisions`
  - `segment_marks_are_purged_with_the_revision`
- Vitest: `BestMoments.test.tsx` `it("plays the reel in order and explains how sentences were picked")`.
- net_guard: `best_moments_builds_no_http_client` (A-32).

**As built (18 Oct)**
- The ♡ Like toggle is on each transcript row in the Studio and the session review (`TakeTranscript`), and in the browser preview's sample review (`Transcript`). It is labelled with the sentence and pressed state for screen readers.
- `best_moments` reads the newest machine revision of each take in the week, measures it as the transcript view does, and skips hesitation candidates you dismissed. A-32 is covered by the A-11 offline list (`storage/confidence.rs`, `commands/confidence.rs`), as for M8 to M11, rather than a separate net_guard test.
- The reel plays the sentences back to back with one hidden player (each from its stored segment start to end) and highlights the one playing; each sentence also has Listen and Open take. It shows on Confidence and on Journey.

