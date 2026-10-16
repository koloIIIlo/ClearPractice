# M7 — Foundations

> **Goal:** make the app ready to grow:
> - a faster start;
> - one place that records effort (the practice-event ledger);
> - one fast snapshot of your practice (facts);
> - support for game-like activities inside ordinary sessions;
> - the Playful/Calm switch;
> - a reusable recorder panel;
> - better test helpers.
>
> **Visible changes:** start-up is faster, there is a new Settings → Practice → Practice style setting, and a one-time "Playful or Calm?" card appears on Today. Everything else is groundwork.
>
> **Schema:** v16. **Effort:** 8–11 days. **Exit gate:**
> - all WPs below are done;
> - the full test suites pass;
> - the entry chunk is within budget;
> - the start-up median is no worse than the baseline;
> - A-38 (backups carry the new data) passes for `practice_events` and `activity_snapshot`.

| WP | Title | Effort |
| --- | --- | --- |
| 7.1 | Speed pass: lazy routes, prefetch, chunking, bundle budget | M |
| 7.2 | Content modules: exercises move to `src/content` | S |
| 7.3 | New exercise types (table rebuilt without the type check), activity settings, per-take steps | M |
| 7.4 | Practice-event ledger (`practice_events`, awards, backfill) | L |
| 7.5 | Practice style: Playful / Calm, celebrations preferences | S |
| 7.6 | Facts snapshot: `get_practice_facts` | M |
| 7.7 | Test helpers, shared no-score check, axe route script | S |
| 7.8 | `commands/` module for new native commands | S |
| 7.9 | `RecorderPanel`: the Studio recorder as a shared component | M |

---

## 7.1 Speed pass

**Goal.** The app currently ships one 1.68 MB JavaScript chunk (474 kB gzip, build of 16 Oct). Every page, Recharts, wavesurfer and cmdk load before Today can show. Split the bundle so Today and the Studio load first and the rest loads on demand, and add a budget so the new pages don't undo it.

**User flow.** Nothing changes for the user, except:
- the app opens faster;
- the first visit to a heavy page (Progress, a session review) shows a thin progress line under the top bar for a moment.

**Front end**
1. **Measure the baseline first.**
   - Run `npm run build`, then `node scripts/bundle-budget.mjs --report`, and copy the table to Notes in `DEVELOPMENT_PLAN.md`.
   - On the packaged build, read Settings → About → Performance (startup median from `getTimings`), and copy that too.
2. **Lazy routes.** In `src/app/routes.tsx`, use React Router's route `lazy` property:
   ```ts
   /** Loads a page module on first visit; the crumb stays static so the breadcrumb never waits. */
   function page<K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) {
     return async () => ({ Component: (await load())[name] });
   }
   // eager: AppShell and TodayPage only; the Studio and Practice complete are prefetched once Today is idle
   { path: "progress", lazy: page(() => import("@/features/progress/ProgressPage"), "ProgressPage"), handle: crumb("Progress") },
   ```
   - Make these lazy (as built on 16 Oct: every page except Today, because chunks load from local disk in a few milliseconds and Today prefetches the Studio):
     - `StudioPage` and `CompletionPage`;
     - the command palette (`CommandPalette`, with cmdk), mounted from its first opening;
     - `ExercisesPage` and `ExerciseDetailPage`;
     - `SessionsPage` and `TrashPage`;
     - `ReviewPage` and `ComparePage`;
     - `PhrasesPage`, `ProgressPage`, `SettingsPage` and `WelcomePage`;
     - every page added from M8 on.
   - Remove the matching static imports at the top of `routes.tsx`. `SessionCrumb` and `ExerciseCrumb` stay.
3. **Pending indicator.** In `src/app/TopBar.tsx`, add `RouteProgress`.
   - It shows a 2 px bar at the bottom edge of the top bar while `useNavigation().state === "loading"`, using `--cp-accent`.
   - A static bar is shown under reduced motion.
   - It is hidden from assistive technology; the route change itself is announced, as today.
4. **Prefetch.** Add `src/app/prefetch.ts`:
   ```ts
   export const ROUTE_MODULES: Partial<Record<NavItem["id"], () => Promise<unknown>>> = {
     exercises: () => import("@/features/exercises/ExercisesPage"),
     sessions: () => import("@/features/sessions/SessionsPage"),
     phrases: () => import("@/features/phrases/PhrasesPage"),
     progress: () => import("@/features/progress/ProgressPage"),
     settings: () => import("@/features/settings/SettingsPage"),
   };
   /** Starts loading a page's code; repeated calls are free (the module cache dedupes). */
   export function prefetchRoute(id: NavItem["id"]): void
   /** After Today has rendered and the window is idle, warms Sessions and Progress. */
   export function prefetchWhenIdle(ids: NavItem["id"][]): () => void
   ```
   - `AppSidebar` items call `prefetchRoute(item.id)` on `pointerenter` and `focus`.
   - `TodayPage` calls `prefetchWhenIdle(["sessions", "progress"])` once. It uses `requestIdleCallback`, with `setTimeout(…, 1500)` as the fallback.
5. **Vendor chunks.** Only if the report shows a library duplicated across lazy chunks.
   - Vite 8 builds with Rolldown, whose option is `build.rolldownOptions.output.codeSplitting.groups` (Rolldown 1.2.11; `advancedChunks` and `manualChunks` are deprecated).
   - As built, the automatic splitting already keeps Recharts in the Progress chunk alone and shares common code without duplicates, so no groups were added.
6. **Budget script.** Add `scripts/bundle-budget.mjs` (Node, no dependencies; gzip from `node:zlib`).
   - It reads `dist/assets/*.js` and finds the start-up files from `dist/index.html`: the entry script plus every chunk it preloads.
   - It prints a table and exits with code 1 if:
     - **start-up JS** (entry plus preloaded chunks) is above **320 kB gzip**;
     - or any lazy chunk is above **250 kB gzip**.
   - With `--report`, it only prints.
   - Add `"check:bundle": "node scripts/bundle-budget.mjs"` to `package.json`, and run it after `npm run build` at milestone gates.

**Tests**
- `src/app/routes.test.tsx` (new):
  - `it("loads each lazy page on first visit and shows its heading")` renders `App` with the mock client at each lazy path in turn and finds the page heading.
  - `it("opens the studio with its recorder")` checks the lazily loaded Studio and its breadcrumb.
  - `it("prefetches the same modules the routes load")`.
  - The first render of a lazy route waits for its code (React Router holds the initial render), so a "breadcrumb while loading" test isn't possible; the loading bar shows on later navigations.
- Existing App, tour and Sessions tests keep passing; they already use `findBy…`.
- Manual check, on the packaged build:
  - the startup median compared with the baseline (Settings → About → Performance), noted in Notes;
  - clicking every sidebar item once shows no blank page and no error.

**As built (16 Oct):** start-up JS fell from one 1.68 MB file (474 kB gzip) to 958 kB in 6 files (285 KiB gzip); the largest lazy chunk is Progress at 103 KiB gzip (Recharts).

**Done when**
- Start-up JS is ≤ 320 kB gzip.
- `npm run check:bundle` passes.
- The startup median is ≤ the baseline.
- All routes open in the desktop app.

---

## 7.2 Content modules

**Goal.** The bundled curriculum lives in `src/content/` (prompts, passages, guides, follow-ups), except the four exercise definitions, which still sit in `src/lib/ipc/mock-data.ts`. Drills, scenarios and missions will add a lot of content, so every content list should live in one place with one test style.

**Front end**
- Move `exercises` from `mock-data.ts` to **`src/content/exercises.ts`**:
  ```ts
  export const EXERCISES: ExerciseDefinition[] = [ /* ex-repeat, ex-thought-groups, ex-imitate, ex-expression, unchanged */ ];
  export const EXERCISE_IDS = { repeat: "ex-repeat", thoughtGroups: "ex-thought-groups", imitate: "ex-imitate", expression: "ex-expression" } as const;
  export function exerciseFor(type: ExerciseType): ExerciseDefinition
  /** Label and icon of every exercise type; replaces EXERCISE_LABELS (SessionsPage) and EXERCISE_ICONS (ExercisesPage). The scheduler keeps its sentence names for the four core types and falls back to these labels. */
  export const EXERCISE_TYPE_INFO: Record<ExerciseType, { label: string; icon: LucideIcon }>
  ```
- `mock-data.ts` re-exports it (`export { EXERCISES as exercises } from "@/content/exercises"`), so the mock client, the tests and `createNativeClient` (which spreads the mock for curriculum) keep working.
- Replace the hard-coded `"/practice/ex-repeat?prompt=…"` strings in `TodayPage.tsx` and `scheduler.ts` with `EXERCISE_IDS.repeat`.
- Content rules, written as a comment at the top of each content file:
  1. A content change that affects how a past session reads bumps `CURRICULUM_VERSION` in `prompts.ts`.
  2. IDs never change once shipped.
  3. Each list has a test in `src/content/<name>.test.ts`: unique IDs, length limits, no empty strings, the required counts from appendix C, and no score or mood words (the `offending()` check from 7.7).

**Tests.** Add `src/content/exercises.test.ts`:
- `it("has the four exercise types once each with unique ids")`;
- `it("keeps the ids used in stored sessions")` checks the snapshot of the four IDs.

**Done when** nothing imports exercises from `mock-data.ts` except the mock client, and the typecheck and the existing tests pass.

---

## 7.3 New exercise types and activity settings

**Goal.** New formats get **exercise types of their own** (D-30, chosen on 16 Oct 2026):
- drills (M10);
- phrase Say it (M11);
- conversation turns (M13);
- talk rehearsals (M14);
- the time capsule (M14).

They are recorded with the existing pipeline, so audio safety, Trash, backups and transcription work unchanged. Two more things are needed: a session remembers a run's settings (seed, parameters, group), and each take remembers which step it was.

**Decision D-30 (chosen 16 Oct 2026): new exercise types**
- `exercise_definitions` is rebuilt once in v16, without its v1 `CHECK(type IN (…))`.
- From then on, exercise types are validated in Rust (`exercise_types::KNOWN`) and in zod (`ExerciseType`). Adding a type never needs another rebuild.
- Each format gets its type and exercise definition when its feature lands:

  | Milestone | Types added |
  | --- | --- |
  | M10 | the drill types (`jam`, `roulette`, `word_bomb`, …) |
  | M11 | `phrase_say_it` |
  | M13 | `conversation`, `upgrade` |
  | M14 | `rehearsal`, `capsule` |

- **M7 adds no new type.** It makes adding one a two-line change.
- **A run's settings** (seed, parameters, group) are stored as JSON in `sessions.activity_snapshot`.
- **Per-take steps** go in the existing, unused `task_conditions.challenge` column.

**Rules**
- **One session per run.** The session's prompt never changes within a session, because `reserve()` refuses a different `prompt_snapshot`. So:
  - a multi-prompt run uses its title as the session prompt, for example "Gauntlet · 5 rounds";
  - each take's own prompt goes in its step.
- **New topic, new session.** "Again with a new topic" starts a new session. "Same topic again" adds a take to the same session.
- **Grouped runs share an ID.** Several sessions that belong together share `activity.groupId`. Examples: a Story Cubes evening, or the sessions of one event plan.
- **One map for labels and icons.** `EXERCISE_TYPE_INFO` (7.2) holds the label and icon of every exercise type. The Exercises page, the Sessions title cell and filter, and the scheduler all use it.
- **The Sessions type filter** lists the four core types plus only the types that occur in your sessions. A long list of drill types never clutters it.

**Data (schema v16, shared with 7.4)**
```sql
-- Exercise types (plan 7.3, D-30 chosen 2026-10-16): new formats get exercise
-- types of their own. The v1 CHECK on type is removed by rebuilding the table
-- once; types are validated in Rust from now on. This script runs with foreign
-- keys off (migrate_rebuild) and foreign_key_check must be empty before commit.
CREATE TABLE exercise_definitions_v16 (
 id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version > 0),
 type TEXT CHECK(type IS NULL OR length(type) BETWEEN 1 AND 40),
 instructions TEXT,
 content_id TEXT,
 PRIMARY KEY(id,version)
) STRICT;
INSERT INTO exercise_definitions_v16(id,version,type,instructions,content_id)
 SELECT id,version,type,instructions,content_id FROM exercise_definitions;
DROP TABLE exercise_definitions;
ALTER TABLE exercise_definitions_v16 RENAME TO exercise_definitions;
-- A run's settings (seed, parameters, group), kept as JSON so a past session
-- always reads as played.
ALTER TABLE sessions ADD COLUMN activity_snapshot TEXT;
```
`task_conditions.challenge` (v1, unused so far) now holds the take's step as JSON, for example `{"index":2,"key":"fast","promptId":"p-sport-var"}`, or NULL.

**Migration path**
- **Why a separate path.** `migrate()` runs each script in one transaction with foreign keys on. A table rebuild can't run that way:
  - SQLite ignores `PRAGMA foreign_keys` inside a transaction;
  - dropping a parent table with foreign keys on would fail.
- **New function** `fn migrate_rebuild(conn: &mut Connection, sql: &str) -> Result<()>`:
  1. `PRAGMA foreign_keys=OFF`, outside any transaction. A guard struct turns foreign keys back on at every exit, errors included.
  2. Begin a transaction and run the script. Then run `SELECT count(*) FROM pragma_foreign_key_check`.
     - If it isn't 0, roll back with: "The database upgrade found inconsistent rows and was not applied. Your recordings are unchanged."
  3. Commit, then `PRAGMA foreign_keys=ON`.
- **Safety**
  - The rebuild follows SQLite's documented order: create the new table, copy, drop the old one, rename the new one.
  - `legacy_alter_table` stays off (the default), so `session_steps`' foreign key keeps pointing at `exercise_definitions`.
  - The "before-v16" snapshot that `open()` already takes before migrating is the fallback.

**Native (Rust)**
- **`src-tauri/src/exercise_types.rs`** (new):
  - `pub const KNOWN: &[&str] = &["repeat", "thought_groups", "imitate", "expression"];`
  - `pub fn is_known(t: &str) -> bool`
  - Later milestones append to `KNOWN`.
- **`PracticeContext::validate`** uses `exercise_types::is_known` instead of its inline list.
- **`src-tauri/src/activity.rs`** (new; M10 adds `TakeEventKind` here):
  ```rust
  #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase", deny_unknown_fields)]
  pub struct ActivityContext {
      pub version: u32,           // 1..=1000
      pub seed: String,           // 1..=64 chars [A-Za-z0-9-]
      #[serde(default)]
      pub group_id: Option<String>,
      #[serde(default)]
      pub params: serde_json::Map<String, Value>, // ≤ 4 KB serialized, scalars or string arrays only
  }
  #[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
  #[serde(rename_all = "camelCase", deny_unknown_fields)]
  pub struct ActivityStep { pub index: u32, pub key: String, #[serde(default)] pub prompt_id: Option<String> }
  impl ActivityContext { pub fn validate(&self) -> Result<(), String> }
  impl ActivityStep { pub fn validate(&self) -> Result<(), String> }   // index ≤ 50, key ≤ 40 chars of [a-z0-9_-]
  ```
- **`PracticeContext`** gains `#[serde(default)] pub activity: Option<ActivityContext>` and `#[serde(default)] pub step: Option<ActivityStep>`. Both are validated.
- **`insert_reservation`** (in `reserve()`):
  - writes `activity_snapshot` on the first take (`UPDATE … WHERE activity_snapshot IS NULL`);
  - refuses a different snapshot on a later take: "This session belongs to another activity.";
  - writes `task_conditions.challenge` from `step` for every take.
- **`get_session`** returns `activitySnapshot` and each attempt's `step`. `list_sessions` is unchanged: its `exerciseType` already tells the format.
- **`take_coaching_input`:** when the take has a `step.promptId`, the coaching "task" uses that prompt's text, not the session title. The UI resolves the text before the preview call.

**IPC (`schemas.ts`, `client.ts`)**
```ts
// ExerciseType keeps the four core types in M7; later milestones add theirs (no database change needed).
export const ActivityContext = z.object({
  version: z.number().int().positive(), seed: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
  groupId: z.string().nullable().optional(), params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).default({}),
}).strict();
export const ActivityStep = z.object({ index: z.number().int().min(0).max(50), key: z.string().regex(/^[a-z0-9_-]{1,40}$/), promptId: z.string().nullable().optional() }).strict();
// SessionDetail:  activitySnapshot: ActivityContext.nullable().optional()
// Attempt:        step: ActivityStep.nullable().optional()
// PracticeContext (client.ts): activity?: ActivityContext; step?: ActivityStep
```
The mock client stores `activitySnapshot` and `step` on simulated sessions and takes in `addSimulatedTake`.

**Front end**
- `useRecorder(title, context)` already passes the context on every start. Activities set `context.step` before each take, and the hook must read the latest context through a ref. Add the ref if the hook currently reads a stale context.

**Tests**
- **Rust** (`database.rs` tests):
  - `v16_rebuild_keeps_every_definition_and_step_and_drops_the_type_check`:
    - seed a v15 database with sessions, steps and the legacy row;
    - after `open()`, the same rows are present and `foreign_key_check` is empty;
    - a definition with type `jam` can be inserted;
    - a step for an unknown exercise is still refused (foreign keys still enforced).
  - `migrate_rebuild_restores_foreign_keys_when_the_script_fails`: a failing script leaves `PRAGMA foreign_keys` at 1 and the database unchanged.
  - `activity_snapshot_is_written_once_and_a_different_one_is_refused`.
  - `take_step_is_stored_in_task_conditions_and_returned_with_the_attempt`.
  - `unknown_exercise_type_or_oversized_activity_params_are_refused`.
- **Vitest:**
  - `native-client.test.ts`: `it("parses sessions with and without activity settings")`.
  - `mock-client.test.ts`: `it("keeps a simulated take's step")`.

**Done when:**
- an upgraded copy of a v15 database opens with every session intact;
- a context with activity settings round-trips through `get_session`;
- adding an exercise type needs only three changes: `exercise_types::KNOWN`, `ExerciseType`, and its label in `EXERCISE_TYPE_INFO`.

---

## 7.4 Practice-event ledger

**Goal.** Record effort once, at the moment it happens, in one append-only table. XP, weekly goals, achievements and the backfill all read it. Nothing ever removes a row (P-3, A-28).

**Data (schema v16)**
```sql
-- Practice events (plan 7.4, D-31): what you did that earns effort points,
-- written in the same transaction as the action. Append-only; Trash and
-- permanent deletion keep these rows (their IDs then stop resolving).
-- Kinds are validated in Rust (engagement::EventKind), not by CHECK, so
-- later milestones add kinds without rebuilding the table. IDs and numbers
-- only: never transcript text, audio or paths (A-30).
CREATE TABLE practice_events (
 id INTEGER PRIMARY KEY,
 kind TEXT NOT NULL,
 ref_id TEXT NOT NULL,
 local_date TEXT NOT NULL CHECK(local_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 session_id TEXT,
 attempt_id TEXT,
 xp INTEGER NOT NULL CHECK(xp BETWEEN 0 AND 1000),
 rules_version INTEGER NOT NULL CHECK(rules_version > 0),
 data TEXT NOT NULL DEFAULT '{}',
 backfilled INTEGER NOT NULL DEFAULT 0 CHECK(backfilled IN (0,1)),
 created_at_ms INTEGER NOT NULL,
 UNIQUE(kind, ref_id)
) STRICT;
CREATE INDEX practice_events_date ON practice_events(local_date, created_at_ms);
PRAGMA user_version=16;
```

**Native (Rust)**

`src-tauri/src/engagement.rs` (new, pure):
```rust
pub const RULES_VERSION: u32 = 1;
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EventKind { TakeSaved, Retake, SequenceCompleted, ReflectionSaved, TranscriptReviewed,
    PhraseSaved, PhraseReviewed, TransferReview, BaselineSaved /* M9+: LevelReached, Achievement,
    PersonalRecord, WeeklyGoal, Quest; M10: DrillRound;
    M11: ReanswerSkipped, Prediction, CatchRun, ProgrammeStep; M12: ExposureStep, Routine, AfterAction;
    M13: Conversation, Upgrade; M14: Mission, EventDebrief, ListenerAnswers, Capsule (appendix B lists every kind) */ }
impl EventKind {
    pub fn as_str(self) -> &'static str;         // "take_saved", …
    pub fn parse(s: &str) -> Option<Self>;
    pub fn xp(self) -> u32;                       // appendix B is the source of truth
    pub fn daily_cap(self) -> Option<u32>;        // PhraseReviewed: 10 events/day; PhraseSaved: 5/day
}
pub struct NewEvent<'a> { pub kind: EventKind, pub ref_id: &'a str, pub local_date: &'a str,
    pub session_id: Option<&'a str>, pub attempt_id: Option<&'a str>, pub data: serde_json::Value }
```

`src-tauri/src/storage/engagement.rs` (new, `#[path]`-included from `database.rs` like `phrases.rs`):
```rust
/// Inserts the event once (UNIQUE(kind, ref_id)); respects daily caps by
/// awarding 0 XP above the cap (the event is still recorded). Returns true if new.
pub(crate) fn award(tx: &Transaction, event: &NewEvent, now_ms: i64) -> Result<bool>
impl DatabaseOwner {
    pub fn list_practice_events(&self, from: Option<&str>) -> Result<Vec<PracticeEvent>>;
    pub fn record_sequence_completed(&self, session_ids: &[String], local_date: &str) -> Result<Option<PracticeEvent>>;
}
fn backfill_practice_events(conn: &Connection) -> Result<()> // once, guarded by app_settings 'engagement_backfill_v1'
```

**Where awards happen.** Each award runs inside the existing transaction.

| Action (existing function) | Event | ref_id | Rule |
| --- | --- | --- | --- |
| `commit_recording` (and the recovery path `recover`) | `take_saved` | attempt ID | duration ≥ 10 s and ordinal ≤ 6 |
| same | `retake` | attempt ID | ordinal 2–6 and duration ≥ 10 s |
| `set_session_reflection` | `reflection_saved` | session ID | ease or takeaway present |
| `set_filler_decision` | `transcript_reviewed` | attempt ID | after this decision, every filler candidate of the current revision has a decision. Count the candidates with `analysis::measure` on the revision's segments, as `record_measures` does |
| `add_phrase` (`phrases.rs`) | `phrase_saved` | card ID | not starter cards; cap 5/day |
| `review_phrase` | `phrase_reviewed` | review row ID | cap 10/day |
| `add_transfer_review` (`transfer.rs`) | `transfer_review` | review ID | — |
| `update_session` when tags gain `baseline` | `baseline_saved` | session ID | once |
| new `record_sequence_completed` (Practice complete) | `sequence_completed` | `{local_date}:{first session ID}` | at least one take in the sequence |

**Backfill.** This is the "head start" (Nunes & Drèze 2006): your history already counts.
- It runs once after migrating to v16 and inserts events for:
  - saved takes, including those in Trash, because effort is never taken away (`take_saved`, `retake`);
  - sessions with a reflection;
  - fully reviewed takes;
  - non-starter phrases;
  - phrase reviews (caps applied per day in time order);
  - transfer reviews;
  - baseline-tagged sessions.
- Each event keeps its original `created_at_ms` and `local_date` and is marked `backfilled = 1`, so nothing celebrates it.

**Commands (7.8 module `commands/engagement.rs`)**
- `list_practice_events(from: Option<String>) -> Vec<PracticeEvent>`
- `record_sequence_completed(session_ids: Vec<String>, local_date: String) -> Option<PracticeEvent>`

**IPC**
```ts
export const PracticeEvent = z.object({ id: z.number().int(), kind: z.string(), refId: z.string(), localDate: z.string(),
  sessionId: z.string().nullable(), attemptId: z.string().nullable(), xp: z.number().int().min(0), backfilled: z.boolean(), createdAt: z.string() }).strict();
listPracticeEvents(from?: string): Promise<PracticeEvent[]>;
recordSequenceCompleted(sessionIds: string[], localDate: string): Promise<PracticeEvent | null>;
// keys.engagementEvents = ["engagement", "events"]
```
- The mock client keeps events in memory, awards `take_saved` and `retake` in `addSimulatedTake`, and seeds about 20 backfilled events for the sample sessions.
- `CompletionPage` calls `recordSequenceCompleted` once on mount when `sessionIds` is not empty, guarded by a ref.

**Tests (Rust, `storage/engagement.rs`)**
- `take_awards_follow_duration_and_ordinal_rules`: 9 s → none; ordinal 7 → none; ordinal 2 → take plus retake.
- `award_is_idempotent_for_the_same_kind_and_ref`.
- `phrase_review_cap_records_events_but_stops_xp_after_ten_a_day`.
- `transcript_reviewed_only_when_every_candidate_has_a_decision`.
- `backfill_runs_once_marks_rows_and_respects_caps`.
- `events_survive_trash_and_permanent_deletion` (A-28).
- `events_hold_ids_and_numbers_only`: scans `data` and `ref_id` for spaces or long text (part of A-30).
- Migration: `opens_a_v15_database_adds_v16_and_backfills`.

**Tests (Vitest)**
- `CompletionPage.test.tsx` (new): `it("records the completed sequence once")`.
- The mock awards XP for simulated takes.

**Done when**
- Every row in the table above awards exactly once.
- The backfill is idempotent.
- Trash and permanent deletion leave events in place.
- `listPracticeEvents` works in both clients.

---

## 7.5 Practice style: Playful or Calm

**Goal.** A single switch decides whether the game layer shows (P-4, A-27). Two further preferences control celebrations. The game layer itself arrives in M9; this WP adds the switch, the hook every later WP uses, and the one-time choice.

**Data.** Preferences (§6.6 of the README):
- `practiceStyle: "playful" | "calm"`, default "playful" (D-32);
- `styleChosen: boolean`, default false;
- `celebrations: "full" | "subtle" | "off"`, default "full";
- `celebrationSounds: boolean`, default false.

Rust `preferences.rs` adds fields, defaults and validation; zod adds fields; `DEFAULT_PREFERENCES` and the mock add defaults.

**Front end**
- `src/hooks/use-reduced-motion.ts`: `useReducedMotion(): boolean`, using `matchMedia("(prefers-reduced-motion: reduce)")` with a change listener.
- `src/features/engagement/style.ts`:
  ```ts
  export type EffectiveStyle = { playful: boolean; celebrations: "full" | "subtle" | "off"; sounds: boolean };
  /** Calm turns celebrations off; reduced motion turns "full" into "subtle". */
  export function effectiveStyle(p: Pick<Preferences, "practiceStyle" | "celebrations" | "celebrationSounds">, reducedMotion: boolean): EffectiveStyle
  export function usePracticeStyle(): EffectiveStyle
  ```
- **Settings → Practice** (`SettingsPage.tsx`, Practice section) gets a **Practice style** group:
  - two radio cards, styled like the session-length cards on Today:
    - **Playful:** "Levels, effort points, achievements and short celebrations. Nothing is ever scored."
    - **Calm:** "Just practice and evidence. Your progress is still kept, so you can switch back any time."
  - **Celebrations** `Select` (Full / Subtle / Off), disabled in Calm, with a hint when reduced motion is on: "Windows asks for reduced motion, so celebrations stay still.";
  - **Celebration sound** `Switch`.
- **One-time choice card** on Today (`TodayPage.tsx`):
  - It shows when `preferences.onboarded && !preferences.styleChosen` and `plan.lastCompleted` exists, so only for people who already practised.
  - It sits above the focus panel, like the setup card:
    ```
    ┌────────────────────────────────────────────────────────────────────────┐
    │ New: levels, effort points and achievements                            │
    │ They reward practising, never how your voice sounds. Prefer it calm?   │
    │                                    [Keep it playful]  [Choose calm]    │
    └────────────────────────────────────────────────────────────────────────┘
    ```
  - Either button sets `styleChosen: true`, and **Choose calm** also sets `practiceStyle: "calm"`.
  - In M7 it says "coming soon" ("Levels and achievements arrive with the next update…") until M9 lands. Set `SHOW_STYLE_CARD = false` in M7, and switch it on in 9.1.

**Tests**
- Rust: `preferences.rs` `practice_style_round_trips_and_rejects_unknown_values`.
- Vitest:
  - `src/features/engagement/style.test.ts`:
    - `it("calm turns everything off")`;
    - `it("reduced motion turns full into subtle but keeps off as off")`.
  - `SettingsPage` test: `it("disables celebrations in calm style")`.
  - `TodayPage` test: `it("shows the style card once and hides it after a choice")`.

**Done when** the preferences round-trip in both clients, Settings shows the group, and the card logic is tested (shown from 9.1).

---

## 7.6 Facts snapshot

**Goal.** One fast native command returns everything the rule engines need, so Journey, Today and the evaluator never make dozens of IPC calls. Today's `getProgress` and `getTodayPlan` make one `get_session` call per session.

**Native, `src-tauri/src/storage/engagement.rs`**
```rust
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct PracticeFacts {
    pub facts_version: u32,                 // 1 in M7; bumped when fields are added
    pub generated_at: String,               // ISO UTC
    pub today: String,                      // local date
    pub transcription_available: bool,      // local Whisper configured (transcribe::CONFIG_KEY present)
    pub sessions: Vec<FactSession>,
    pub takes: Vec<FactTake>,
    pub transfer_reviews: Vec<FactTransfer>,
    pub phrases: Vec<FactPhrase>,
    pub phrase_reviews: Vec<FactPhraseReview>,
    pub progression: Vec<ProgressionEvent>,
}
pub struct FactSession { id, local_date, started_at, exercise_type, content_id: Option<String>,
    tags: Vec<String>, familiarity: Option<String>, preparation_seconds: Option<u32>, target_seconds: Option<u32>,
    audience: bool, follow_up: bool, outline: [bool; 3] /* point, reason, example filled */, ease: Option<u8>,
    focus: Option<String>, takeaway: bool, status: String, take_count: u32, duration_ms: u64, preferred_take: Option<String> }
pub struct FactTake { id, session_id, ordinal, local_date, created_at, duration_ms, step_key: Option<String>,
    transcribed: bool, revision_id: Option<String>, words: Option<u32>, pace_wpm: Option<f64>, speech_span_ms: Option<u64>,
    filler_candidates: Option<u32>, fillers_confirmed: Option<u32>, fillers_reviewed: bool, pauses_over_threshold: Option<u32>,
    prosody_viewed: bool, has_ai_feedback: bool }
pub struct FactTransfer { id, local_date, has_listener_words: bool, needed_clarification: bool, has_success: bool, has_next_focus: bool }
pub struct FactPhrase { id, created_at, starter: bool, deleted: bool }
pub struct FactPhraseReview { card_id, local_date, rating }
impl DatabaseOwner { pub fn practice_facts(&self, today: &str) -> Result<PracticeFacts> }
```
- **Sources:**
  - sessions via the `list_sessions` join plus `task_conditions` of each session's first take;
  - takes via `attempts` (saved, not trashed, session not trashed);
  - measures from `metric_values` of the take's **current revision**.
- **Current revision** means the same revision `attempt_transcript` treats as current. Extract its choice into `fn current_revision_id(conn, attempt_id) -> Option<String>` and use it in both places.
- **Filler counts:**
  - `fillers_confirmed` counts `annotations` rows with `decision='confirmed'` for that revision and definition version;
  - `fillers_reviewed` is true when the number of decisions ≥ `filler_candidates`.
- **Other derived fields:**
  - `prosody_viewed` is true when a `prosody_tracks` row exists (the track is computed when you open it);
  - `has_ai_feedback` is true when a `coaching_runs` row exists.
- **Query plan:** about six statements, each a single pass. The sessions query uses `sessions_date`; the takes query uses `attempts_step` and `transcripts_attempt`. The function returns everything (no paging): two years of daily practice is about 1,500 sessions and 4,000 takes, roughly 1 MB of JSON.
- **Later milestones** add fields: `FactTake.mean_run`, `phrase_ids_used`, self-checks (M8); `take_events` counts (M10); exposure attempts (M12); conversations (M13); and so on. Each addition bumps `facts_version`.

**Command:** `get_practice_facts() -> PracticeFacts`. Today's date is computed in Rust with `Local::now()`, as the rest of the storage code does.

**IPC.** `PracticeFacts`, `FactSession`, `FactTake`, `FactTransfer`, `FactPhrase`, `FactPhraseReview` zod schemas (`.strict()`), and `getPracticeFacts(): Promise<PracticeFacts>`, with `keys.facts = ["engagement", "facts"]`. The mock builds facts from its sample sessions; 7.7's `factsBuilder` is used in tests.

**Later.** Rewrite `getProgress` and `getTodayPlan` in `native-client.ts` to use facts where they only need these fields. This is optional in M7, done in 8.6.

**Tests**
- Rust:
  - `facts_include_only_saved_untrashed_takes_and_their_current_revision_measures`;
  - `fillers_reviewed_needs_a_decision_for_every_candidate`;
  - `facts_report_outline_fields_and_conditions_from_the_first_take`;
  - `practice_facts_two_years_under_80ms` (`#[ignore]`, uses `seed_history`; A-36).
- Vitest: `native-client.test.ts` `it("parses facts from the native command")` uses a recorded JSON fixture `src/lib/ipc/fixtures/facts-v1.json`, generated once from the Rust test with `--nocapture` and checked in.

**Done when** facts match `get_session` and `get_attempt_transcript` for the same data in a Rust cross-check test (`facts_agree_with_session_and_transcript_views`), and the bench is under budget.

---

## 7.7 Test helpers

**Goal.** Make the hundreds of new tests short and consistent.

**Files**
- `src/test/render.tsx`:
  ```ts
  export function renderWithApp(ui: ReactNode, opts?: { client?: IpcClient; path?: string; routes?: { path: string; element: ReactNode }[] }): RenderResult & { client: IpcClient; queryClient: QueryClient }
  ```
  It wraps `MemoryRouter`, a fresh `QueryClient` with retry off, `IpcContext` and a `Toaster`. When `routes` is given, it renders `Routes` with `ui` at `opts.path ?? "/"` and the extra routes, for example `/sessions/trash` → `<p>Trash page</p>`, as `SessionsPage.test.tsx` does today.
- `src/test/fixtures/facts.ts`:
  ```ts
  export function factsBuilder(today = "2026-10-12"): FactsBuilder
  interface FactsBuilder {
    session(p?: Partial<FactSession>): FactsBuilder;          // adds a session (defaults: repeat, familiar, today)
    take(p?: Partial<FactTake>): FactsBuilder;                // adds a take to the last session
    transfer(p?: Partial<FactTransfer>): FactsBuilder;
    phrase(p?: Partial<FactPhrase>): FactsBuilder;
    phraseReview(p?: Partial<FactPhraseReview>): FactsBuilder;
    onDay(offsetDays: number): FactsBuilder;                  // following items use today - offset
    build(): PracticeFacts;                                   // parsed with the zod schema
  }
  ```
- `src/test/no-scores.ts`: move `GRADE`, `PERCENT`, `MOOD`, `NEGATION` and `offending()` out of `a22-no-scores.test.tsx`, which imports them, and add `expectNoScores(container: HTMLElement)`.
- `src/test/clock.ts`: `withFakeToday(localDate: string, fn: () => Promise<void> | void)`.
- Rust: `storage::engagement::tests::seed_history(db: &DatabaseOwner, days: u32, takes_per_day: u32)` inserts realistic rows directly with SQL (sessions, steps, attempts, assets with fake hashes, revisions, metrics) for facts and bench tests.
- `scripts/a11y/axe_routes.py`: the scratchpad Playwright and axe audit made permanent.
  - It reads `ROUTES` (a list at the top of the file), visits each in light and dark at 1280×900 against `npm run dev`, prints violations, and exits 1 on any.
  - It needs Python Playwright, already used on this laptop; document the setup in the file header.
  - It is not part of `npm test`.

**Tests.** `src/test/fixtures/facts.test.ts`:
- `it("builds facts that pass the schema")`;
- `it("places items on the requested days")`.

**Done when** two existing tests (`SessionsPage.test.tsx`, `PhraseSuggestions.test.tsx`) use `renderWithApp` as examples, and A-22 imports the shared check.

---

## 7.8 `commands/` module

**Goal.** `lib.rs` has 137 commands in 2,600+ lines. New commands go in `src-tauri/src/commands/<area>.rs`.

**Native**
- `src-tauri/src/commands/mod.rs`: `pub mod engagement;` (later `insights`, `drills`, `learning`, `confidence`, `partner`, `events`, `social`, `sync`).
- Make `SessionStorage`, `with_storage` and `ApiAccounting` `pub(crate)` in `lib.rs`.
- Register the new commands in `generate_handler![…, commands::engagement::get_practice_facts, …]`.
- Each command file starts with a doc comment naming its WP numbers.
- **Convention:** commands are thin. They validate the arguments, call one `DatabaseOwner` method or pure function inside `with_storage`, and map errors to plain sentences.

**Tests.** `cargo build` plus one smoke test per new file that calls the underlying `DatabaseOwner` method (commands themselves need a Tauri runtime and are not unit-tested, as today).

**Done when** 7.4 and 7.6's commands live there and the app builds.

---

## 7.9 `RecorderPanel`: the shared recorder

**Goal.** Drills, the conversation partner, phrase Say it, the talk rehearsal and the time capsule all need the Studio's recorder. Today that recorder is about 120 lines inside `StudioPage.tsx`:
- the status pill;
- the clock;
- the live waveform with the level monitor;
- the Record/Stop pill with the level halo;
- the microphone chip;
- the countdown switch;
- the Ctrl+Enter shortcut;
- the leave guard.

Extract it once, so every activity gets the same audio safety (P-9).

**Front end**
- `src/features/practice/RecorderPanel.tsx`:
  ```ts
  export interface RecorderPanelProps {
    rec: Recorder;                         // from useRecorder
    /** Inside the recorder, between the waveform and the button (RepeatFocus today; drill clocks later). */
    inside?: ReactNode;
    /** Replaces the clock (drills show a countdown ring). */
    clock?: ReactNode;
    /** Label overrides, e.g. "Start round" instead of "Record". */
    labels?: Partial<{ record: string; again: string; stop: string }>;
    /** Hide the 3-second countdown switch (activities with their own think time). */
    hideCountdown?: boolean;
    /** Called instead of the default start, e.g. to set the take's step first. */
    onBeforeStart?: () => void;
    /** Shown under the controls instead of the default hint line. */
    footer?: ReactNode;
    tourId?: string;                       // data-tour value, "record" in the Studio
  }
  export function RecorderPanel(props: RecorderPanelProps): JSX.Element
  export function useRecorderGuard(rec: Recorder): JSX.Element   // the leave AlertDialog + useBlocker
  export function RecorderStatus({ rec }: { rec: Recorder }): JSX.Element  // moved from StudioPage
  ```
  - `RecorderPanel` owns:
    - device selection (`useInputDevices`, `usePreferences`);
    - `useLevelMonitor`;
    - the Ctrl+Enter handler;
    - the start and stop cues.
  - Its parent owns `useRecorder` (so it can read takes), the take list and auto-transcription.
- `StudioPage.tsx` uses `RecorderPanel` and `useRecorderGuard`. Its markup and behaviour stay identical: the same labels, data-tour attributes, live regions and toasts.
- Timed activities need no new recorder API:
  - `rec.stopAndSave()` already exists; activities call it when their clock runs out.
  - `rec.start({ countdownSeconds: 0, deviceId })` starts at once. `useSelectedDevice()` (exported from `RecorderPanel.tsx`) gives an activity the same microphone the panel uses.
  - `useRecorder` now reads its context through a ref when a take really starts (after any countdown), so a step set just before Record is never stale (7.3).
- As built, `RecorderPanel` also takes `deemphasize` (Record as an outline button while a sequence's Next step is the primary action) and owns the spoken state changes, the start and stop cues and the saved toast.

**Tests**
- The existing Studio tests (`recorder.test.tsx`, `level-monitor.test.tsx`, `auto-transcribe.test.tsx`, tour) pass unchanged.
- New `RecorderPanel.test.tsx`:
  - `it("renders the inside slot between the waveform and the button")`;
  - `it("uses label overrides")`;
  - `it("starts at once without the countdown switch and calls onBeforeStart first")`;
  - `it("Ctrl+Enter stops a take when no dialog is open")`.
- `useRecorderGuard` test: `it("asks before leaving while recording and saves on Stop and save")`, moved from the Studio test if one exists, otherwise new.
- **Manual (desktop):**
  - record two takes in the Studio;
  - try to navigate away while recording;
  - close the window while recording;
  - check that everything behaves exactly as before.

**Done when** the Studio has no visual or behavioural change (compare screenshots before and after in light and dark) and `RecorderPanel` is ready for M10.
