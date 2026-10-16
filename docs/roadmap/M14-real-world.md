# M14 — Real world: missions, events, talks, listeners, time capsule

> **Goal.** Carry practice into real life, with five features:
> - **Missions:** small weekly challenges in real conversations.
> - **Event mode:** a spaced plan for a real talk, interview or meeting.
> - **Talk builder:** an outline, cue cards and a timed rehearsal report.
> - **Listener pack:** a file a friend opens, listens to and answers. No cloud and no account.
> - **Time capsule:** answer your first question again every month, then compare.
>
> **What you'll see:**
> - a new **Events** page;
> - a mission row in "This week";
> - **Ask a listener** on takes;
> - **Import listener answers**;
> - the monthly capsule card.
>
> **Schema:** v23. **Effort:** 12–17 days. **Needs:** M9 (quests, criteria) and M12 (routine, after-action review).
>
> **Exit gate:**
> - every WP is done;
> - A-34 passes, including opening `listen.html` offline in Edge;
> - an event plan can be followed end to end with the system date changed;
> - the rehearsal report matches the section marks in tests.

| WP | Title | Effort |
| --- | --- | --- |
| 14.1 | Missions | M |
| 14.2 | Event mode | L |
| 14.3 | Talk builder, cue cards, rehearsal report | L |
| 14.4 | Listener pack (export and import) | L |
| 14.5 | Voice time capsule | S |

**Schema v23**
```sql
-- Real world (M14).
CREATE TABLE mission_picks (
 week TEXT PRIMARY KEY CHECK(week GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 mission_id TEXT NOT NULL,
 picked_at_ms INTEGER NOT NULL,
 review_id TEXT,
 done_at_ms INTEGER
) STRICT;
ALTER TABLE transfer_reviews ADD COLUMN mission_id TEXT;
-- Events you prepare for (14.2): user content, soft-deleted.
CREATE TABLE events (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 120),
 kind TEXT NOT NULL CHECK(kind IN ('talk','interview','meeting','toast','pitch','other')),
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 start_time TEXT CHECK(start_time IS NULL OR start_time GLOB '[0-2][0-9]:[0-5][0-9]'),
 minutes INTEGER CHECK(minutes BETWEEN 1 AND 480),
 audience TEXT NOT NULL DEFAULT '' CHECK(length(audience) <= 200),
 goal TEXT NOT NULL DEFAULT '' CHECK(length(goal) <= 500),
 talk_id TEXT,
 created_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE event_plan_items (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL REFERENCES events(id),
 position INTEGER NOT NULL CHECK(position > 0),
 local_date TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('outline','run_through','qa_drill','mock','dress_rehearsal','routine','debrief')),
 title TEXT NOT NULL,
 done_at_ms INTEGER,
 ref_id TEXT,
 UNIQUE(event_id, position)
) STRICT;
-- Talks (14.3): outline sections with target times; rehearsals link a take to a talk.
CREATE TABLE talks (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 2 AND 120),
 template TEXT,
 created_at_ms INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL,
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE talk_sections (
 id TEXT PRIMARY KEY,
 talk_id TEXT NOT NULL REFERENCES talks(id),
 position INTEGER NOT NULL CHECK(position > 0),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 80),
 keywords TEXT NOT NULL DEFAULT '[]',
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes) <= 2000),
 target_seconds INTEGER NOT NULL CHECK(target_seconds BETWEEN 5 AND 3600),
 deleted_at_ms INTEGER
) STRICT;
CREATE TABLE rehearsals (
 id TEXT PRIMARY KEY,
 talk_id TEXT NOT NULL REFERENCES talks(id),
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 sections TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL
) STRICT;
-- Listener packs you exported (14.4) and the answers you imported.
CREATE TABLE listener_packs (
 id TEXT PRIMARY KEY,
 session_id TEXT NOT NULL REFERENCES sessions(id),
 attempt_id TEXT NOT NULL REFERENCES attempts(id),
 questions TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL
) STRICT;
CREATE TABLE listener_feedback (
 id TEXT PRIMARY KEY,
 pack_id TEXT NOT NULL REFERENCES listener_packs(id),
 listener_name TEXT NOT NULL DEFAULT '' CHECK(length(listener_name) <= 60),
 answers TEXT NOT NULL,
 answered_at TEXT,
 imported_at_ms INTEGER NOT NULL
) STRICT;
PRAGMA user_version=23;
```

- `rehearsals.sections` is a snapshot of the section IDs, titles and targets at rehearsal time, so old reports still read correctly after you edit the talk.
- **Purge.**
  - `purge_take_rows` deletes `rehearsals`, `listener_packs` and their `listener_feedback` for the take.
  - Session deletion does the same through the takes.
  - Events, talks and missions are user content with their own soft delete.

---

## 14.1 Missions

**Goal.** Small, concrete real-life challenges, one a week, which you choose. They are logged with the reflection you already know.

**Content** (`src/content/missions.ts`, appendix C)
```ts
export type Mission = { id: string; title: string; how: string; area: AreaId; difficulty: 1 | 2 | 3; tags: string[] };
export const MISSIONS: Mission[];   // 40: e.g. "Ask one question in a meeting" (courage, 1), "Tell a one-minute story at dinner" (storytelling, 2), "Explain your job to someone outside your field" (structure, 2), "Disagree politely with one point" (spontaneity, 3)
```

**User flow**
1. **Pick a mission.** The **This week** list (Today and Journey) has a **Mission** row. With no pick yet, it offers three missions, one of each difficulty, seeded by week and leaning toward your weakest area, plus **Choose another**. You can pick one or skip.
2. **Log it.** **I did it** opens the reflection form with the mission preselected. The form sets `mission_id`, and the situation text is prefilled from the mission title.
3. **XP.** Saving it awards `mission` (40 XP). Quest slot 2 (9.9) counts the mission when one is picked.

**Native**
- `storage/events.rs`: `pick_mission(week, mission_id)`, `mission_pick(week)`, `clear_mission(week)`.
- `add_transfer_review` accepts `mission_id` and sets `mission_picks.done_at_ms` and `review_id`.
- Facts: `FactTransfer.missionId`.

**Tests**
- `missions.test.ts`:
  - `it("offers one mission per difficulty, leaning toward the weakest area")`
  - content checks (unique IDs, 40 missions, every area covered)
- Rust: `a_reflection_with_a_mission_marks_the_pick_done_and_awards_once`
- `MissionCard.test.tsx`: `it("prefills the reflection form")`

---

## 14.2 Event mode

**Goal.** "Couch to 5K" for a real talk, interview, meeting, toast or pitch. You enter the date, and the app spreads the preparation over the days before it. Spaced rehearsal beats cramming (Cepeda et al. 2006). After the event comes a debrief.

**Screens**

`/events` (lazy; nav item `{ id: "events", label: "Events", icon: CalendarClock }`, shown in both styles):
```
┌ Events ─────────────────────────────────────────────── [New event] ┐
│ Interview at Acme · Thu 23 Oct · in 6 days                          │
│ Today: run-through 2 (20 min)                       [Start]         │
│ ✓ Outline your answers · ✓ Run-through 1 · ○ Q&A drill · ○ Mock …   │
├ Past events ────────────────────────────────────────────────────────┤
│ Team demo · 2 Oct · debrief written                  [Open]         │
└─────────────────────────────────────────────────────────────────────┘
```

**New event** dialog (`EventForm.tsx`):
- title;
- kind (Talk, Interview, Meeting, Toast, Pitch, Other);
- date, using a `DatePicker` built on the shadcn `Calendar` primitive and never a native date input:
  - add the primitive to `src/components/ui/calendar.tsx` and style it to the tokens;
  - it brings in `react-day-picker`, so pin the exact version;
  - check that its axe result is clean;
- optional time;
- length in minutes;
- audience;
- goal, the one sentence you want them to remember.

Then **Create plan** shows the generated plan for review, and you can edit dates or remove items before saving.

`/events/:eventId` (`EventPage.tsx`):
- a timeline of plan items with dates and status;
- each item has its action button:
  - **Outline** opens the talk builder (14.3), or for an interview the STAR stories template;
  - **Run-through** and **Dress rehearsal** open a rehearsal (14.3);
  - **Q&A drill** opens the Q&A panel (13.9) or the scripted boss (10.13);
  - **Mock** opens a partner scenario (13.x): the job interview for interviews, the status update for meetings;
  - **Routine** opens the pre-talk routine (12.3) with `eventId`;
  - **Debrief** opens the after-action form (12.4), prefilled with the event title.

**Plan generator** (`src/lib/events/plan.ts`):
```ts
export type PlanItem = { position: number; localDate: string; kind: EventItemKind; title: string };
/** Spreads preparation over the days left. days = event date − today. */
export function buildEventPlan(event: { kind: EventKind; localDate: string; minutes: number | null }, today: string): PlanItem[]
```

| Days left | Plan |
| --- | --- |
| ≥ 10 | outline (today) · run-through 1 (at 60% of the time left) · Q&A drill (50%) · run-through 2 (35%) · mock (25%, interviews and meetings) · dress rehearsal (D−2) · routine (D−0) · debrief (D−0, after the time, or D+1) |
| 4–9 | outline (today) · run-through 1 (today+1) · Q&A drill (middle) · dress rehearsal (D−1) · routine (D−0) · debrief (D+0 or D+1) |
| 1–3 | outline + run-through (today) · dress rehearsal (D−1, if it exists) · routine (D−0) · debrief |
| 0 | routine · one run-through now · debrief |

- No two rehearsal items fall on the same day when avoidable.
- Weekends are not skipped: the user edits dates.

**Rules**
- **Items finish themselves when their work appears.** Each item can also be ticked by hand.

  | Item | Finishes when |
  | --- | --- |
  | Run-through or dress rehearsal | a rehearsal of the event's talk is saved on or after the item's date |
  | Q&A drill | a Q&A panel or scripted boss is played on or after its date |
  | Mock | a conversation is played on or after its date |
  | Routine | a routine run with this `event_id` is saved |
  | Debrief | an after-action review with `extra.eventId` is saved |

- **Today** shows the next item that is due or overdue in This week: "Interview in 6 days · today: run-through 2". Information only: no ticking countdown, no red.
- **After the event date,** the event moves to Past events once its debrief is written, or after 7 days.
- **XP:** an `event_debrief` event (40 XP) when the debrief is saved. Courage level 5 uses event debriefs (appendix A).

**Native**
- `storage/events.rs`:
  - `save_event(input) -> Event`, `delete_event(id)`, `list_events()`;
  - `save_event_plan(event_id, items)` replaces the event's not-done items;
  - `set_plan_item_done(item_id, done, ref_id)` and `refresh_event_items(event_id)` (auto-detection in SQL);
  - `get_event(id) -> EventView`.
- Commands in `commands/events.rs`.
- Facts: `events: { id, kind, date, debriefDone }[]`.

**Tests**
- `plan.test.ts`:
  - `it("spreads items by the documented percentages for ten or more days")`
  - `it("compresses for four to nine, one to three and zero days")`
  - `it("adds a mock only for interviews and meetings")`
  - `it("never schedules two rehearsals on one day when avoidable")`
- Rust:
  - `plan_items_auto_complete_from_rehearsals_conversations_routines_and_reviews`
  - `deleting_an_event_keeps_its_rehearsal_takes`
- `EventPage.test.tsx`:
  - `it("opens each item's action")`
  - `it("Today shows the next item")`
- **Manual:**
  1. Create an event 10 days ahead.
  2. Move the system date and follow the plan for three items.
  3. **Observe:** items tick themselves and Today follows.

---

## 14.3 Talk builder, cue cards, rehearsal report

**Goal.** Prepare a structured talk, rehearse it with cue cards, and see a report of time per section, like PowerPoint's Speaker Coach but local and without scores.

**Talk builder** (`/events/talks/:talkId`; also reachable from an event's Outline item and from Exercises → Prompts → **Build a talk**):
```
┌ Team demo ── target 5:00 · sections 5:10 ───────── Template: Classic ▾ ┐
│ 1 Opening          0:30  keywords: problem · why it matters    [↑][↓][×]│
│ 2 What we built    1:30  keywords: search · filters                      │
│ 3 How it works     1:30  keywords: index · cache                         │
│ 4 What's next      1:00  keywords: mobile · beta                         │
│ 5 Close            0:40  keywords: ask · thanks                          │
│ [Add section]        [Cue cards]   [Rehearse]   [Reports]               │
└─────────────────────────────────────────────────────────────────────────┘
```
- **Sections:** each has a title, up to 3 keywords (chips), notes and a target time. Move them with the up and down buttons, which also work by keyboard.
- **Templates** (`src/content/talk-templates.ts`):

  | Template | Sections |
  | --- | --- |
  | Classic | Opening · 3 points · Close |
  | Story | Situation · Complication · Resolution · Lesson |
  | STAR answer | Situation · Task · Action · Result |
  | Pitch | Problem · Solution · Why now · Ask |
  | Toast | Who you are · A story · A wish · Raise a glass |
  | Update | Done · Next · Blockers |

**Cue cards** (`CueCards.tsx`):
- Full screen, one card per section, showing the big title and up to 3 keywords.
- Controls:
  - **→**, **PageDown** or **Space** go to the next card; **←** or **PageUp** go back. Presenter clickers send PageDown and PageUp.
  - **Esc** exits.
- The section's target time shows small on each card.

**Rehearse**
- This is a cue-card view with the recorder (`RecorderPanel`) docked at the bottom. The recording is a take in a session:
  - exercise type `rehearsal` (exercise `ex-rehearsal`), with `activity.groupId` set to the talk ID;
  - the session prompt is the talk title.
- Moving to the next card during recording writes a `section_mark {sectionId}` take event at the elapsed time. Section 1 starts at 0.
- On stop, a `rehearsals` row is written with a snapshot of the sections.

**Rehearsal report** (`RehearsalReport.tsx`, computed by `storage/events.rs` `rehearsal_report(attempt_id)`):
```
Section          Target   Actual   Words   Pace (est.)   Hesitation candidates
1 Opening         0:30     0:41     88      128           1
2 What we built   1:30     1:22     170     124           0
…
Total             5:00     5:18
[bar chart: target vs actual per section]   [Compare with rehearsal 1 ▸]
```
- **Section spans:** each runs from its mark to the next mark, or to the end of speech.
- **Measures per section:** words, hesitation candidates and pace come from transcript segments whose **start** falls in the section. This is approximate, segment-level, labelled Estimated, and never uses manufactured word times.
- **Over and under target:** shown as "+0:11" and "−0:08", with no colour judgement and no "too long".
- **Comparing rehearsals** draws one line per section across rehearsals, over time.

**Native**
- `storage/events.rs`:
  - `save_talk(input) -> TalkView` (sections replace), `delete_talk`, `list_talks`, `get_talk`;
  - `record_rehearsal(talk_id, attempt_id)` snapshots the sections;
  - `rehearsal_report(attempt_id) -> RehearsalReport`.
- Commands in `commands/events.rs`.
- `TakeEventKind` gets `SectionMark`.

**Tests**
- Rust:
  - `rehearsal_report_splits_by_marks_and_assigns_segments_by_start_time`
  - `report_reads_the_snapshot_after_the_talk_changes`
  - `missing_marks_put_everything_in_section_one_with_a_note`
- `TalkBuilder.test.tsx`:
  - `it("applies a template, reorders by keyboard and totals the targets")`
- `CueCards.test.tsx`:
  - `it("moves with arrows, PageDown and Space and exits with Escape")`
- `Rehearse.test.tsx`:
  - `it("writes a section mark when the card advances while recording")`
- `RehearsalReport.test.tsx`:
  - `it("shows over and under as times without judgement")`
  - `expectNoScores`

---

## 14.4 Listener pack (export and import)

**Goal.** Get real feedback from a friend, colleague or teacher on one take, as a file they open in any browser. They listen, answer three questions and save an answer file to send back. There is no ClearPractice server, no upload and no account (D-35).

**Export flow**
1. **Choose a take.** On a take (Studio row menu, or session review): **Ask a listener…** opens a dialog:
   - **Questions**, editable, 1–5, each ≤ 160 characters. The defaults:
     1. What was my main point?
     2. Where did you get lost, if anywhere?
     3. What helped you follow?
   - **Your first name** (optional, shown to the listener).
   - **Include the transcript?** Default **no**. The listener should listen, not read.
2. **Save the pack.** **Save the pack…** opens a native save dialog (Rust, `tauri-plugin-dialog`, D-25). It writes `<session title> - for a listener.zip`, containing:

   | File | Contents |
   | --- | --- |
   | `listen.html` | A self-contained page (inline CSS and JS, no external resources) with `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; media-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">`. It shows an `<audio controls src="audio.wav">`, the questions, an optional name field for the listener, and **Save my answers**, which builds `answers.cpanswer.json` as a Blob download. The page explains: "Nothing is sent anywhere. Save the answer file and send it back to Alex however you like." |
   | `audio.wav` | 16 kHz mono derived from the take (`audio::prepare`, as for API previews), about 1.9 MB per minute |
   | `pack.json` | `{ "format": "clearpractice-listener-pack", "version": 1, "packId", "questions", "from", "createdAt" }` |
   | `transcript.txt` | only when chosen |
   | `README.txt` | a short plain-text instruction |
3. **Store the pack.** A `listener_packs` row is written. The session shows "Waiting for a listener's answers (pack made 14 Oct)".

**Import flow**
- On the session review, or in Progress → Real conversations: **Import listener answers…** opens a native open dialog, filtered to `.cpanswer.json` and at most 64 KB.
- **Validation** (`listener_pack::parse_answers`):
  - `format` must be `clearpractice-listener-answers` and `version` must be 1;
  - `packId` must match an existing pack;
  - there must be exactly as many answers as questions;
  - each answer is at most 2,000 characters and has its control characters stripped;
  - the name is at most 60 characters;
  - unknown fields are refused;
  - the same file imported twice is ignored (hash check).
- **Display:** the answers appear under the take as **"Listener's words"** (labelled Your note, listener). They are kept apart from your own notes, as the reflection form does (§7 transfer).
- **XP and levels:** `listener_answers` (30 XP). They count toward Structure 5 and Courage (appendix A).

**Native** (`src-tauri/src/listener_pack.rs`, plus commands in `commands/events.rs`):
```rust
pub const PACK_FORMAT: &str = "clearpractice-listener-pack"; pub const ANSWERS_FORMAT: &str = "clearpractice-listener-answers";
pub fn listen_html(questions: &[String], from: &str, include_transcript: bool) -> String   // template in src-tauri/src/listener_pack/listen.html (include_str!), values HTML-escaped and JSON-encoded
pub fn write_pack(zip_path: &Path, pack: &PackManifest, wav: &Path, transcript: Option<&str>) -> Result<()>
pub fn parse_answers(bytes: &[u8]) -> Result<Answers>
// commands: export_listener_pack(attempt_id, questions, from, include_transcript) -> Option<String /* saved file name */>,
//           import_listener_answers() -> Option<ListenerFeedback>, list_listener_feedback(session_id)
```

**Tests**
- Rust:
  - `listen_html_escapes_questions_and_names` (questions containing `</script>`, quotes and emoji)
  - `listen_html_has_a_strict_csp_and_no_external_urls`: no `http`, no `//`, apart from the CSP text itself
  - `pack_contains_exactly_the_expected_files`
  - `answers_are_validated_strictly_and_imported_once`
  - `answers_for_an_unknown_pack_are_refused`
- `net_guard`: `listener_pack_builds_no_http_client` (A-32).
- Vitest:
  - `ListenerPackDialog.test.tsx`:
    - `it("defaults to three questions and no transcript")`
    - `it("limits questions to five")`
  - `ListenerAnswers.test.tsx`:
    - `it("shows the listener's words apart from your notes")`
- **A-34 manual:**
  1. Export a pack and unzip it.
  2. Open `listen.html` in Edge with the network off.
  3. Play the audio, answer and save.
  4. Import the answer file.
  5. **Observe:** the answers appear, and importing the same file again changes nothing.

---

## 14.5 Voice time capsule

**Goal.** "You versus you": once a month, answer the same question as your first recording, then compare the first and latest.

**Rules**
- **The capsule prompt** is your baseline prompt (4.19). If there is none, it is the first prompt you ever answered.
- **On the first app day of each month,** Today's This week list shows "Time capsule: answer your first question again (about 2 minutes)". It stays for 7 days. It is not shown again that month once done or dismissed.
- **The take** goes in a session of exercise type `capsule`, after which **Compare with your first** opens A/B listen (8.5). Measures sit side by side in a "then → now" table, with no colours and no judgement.
- **Progress → Profile** gets a "Your capsules" row with month chips. Clicking two of them compares them.
- **XP:** a `capsule` event (20 XP). Achievements: `capsule-2`, `capsule-6`, `capsule-12`.

**Tests**
- `capsule.test.ts`:
  - `it("offers the capsule in the first week of a month once")`
  - `it("uses the baseline prompt or the first prompt answered")`
- `TimeCapsule.test.tsx`: `it("opens the comparison with the first take")`
