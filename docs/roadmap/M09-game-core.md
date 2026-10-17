# M9: Game core

> **Goal.** Turn practice into a game that rewards effort, choice and real-world wins, and never grades your voice. It has:
> - a skill map of 8 areas with 5 levels each, earned with practice evidence;
> - effort points (XP);
> - achievements;
> - personal records against your past self;
> - a weekly goal instead of a fragile streak;
> - weekly quests;
> - short celebrations;
> - an optional companion;
> - accent colours you unlock.
>
> **Visible changes**
> - A **Journey** page in the sidebar.
> - A **This week** strip on Today.
> - A **Today you earned** panel on Practice complete.
> - XP shown on the take-saved toast.
> - The goal ring on the week row.
> - Celebrations.
> - New reflection fields (how it flowed, what kind of conversation).
>
> **Decisions.** Needs D-29, D-31 and D-32 confirmed.
> **Schema.** v18.
> **Effort.** 14–19 days.
>
> **Exit gate**
> - All WPs are done.
> - A-26 (no scores), A-27 (Calm), A-28 (never taken away), A-29 (AI can't award) and A-30 (IDs only) pass.
> - The axe script is clean on `/journey` and `/journey/achievements` in light and dark.
> - The manual recipe "a week of play" passes on the packaged build.

| WP | Title | Effort |
| --- | --- | --- |
| 9.1 | Journey page, navigation, style card switched on | M |
| 9.2 | Levels engine: areas, criteria DSL, evaluation | L |
| 9.3 | Engagement storage: levels, achievements, records, quests | M |
| 9.4 | `EngagementProvider`: the refresh loop | M |
| 9.5 | XP display | S |
| 9.6 | Achievements | M |
| 9.7 | Personal records | M |
| 9.8 | Weekly goal and weeks in a row | M |
| 9.9 | Weekly quests | M |
| 9.10 | Celebrations | M |
| 9.11 | Companion (Sprout) | M |
| 9.12 | Accent colours | S |
| 9.13 | Monthly themes and fresh starts | S |
| 9.14 | Today strip and Today you earned | M |
| 9.15 | Area sheet, Practise this, soft locks | M |
| 9.16 | Reflection fields: flow and kind | S |

**Schema v18**
```sql
-- Game core (M9, D-29, D-31). Ledgers: kept when sessions or takes are purged
-- (their IDs stop resolving). IDs and numbers only (A-30).
-- Levels you reached, in order, with the evidence that met the criteria (9.2).
CREATE TABLE skill_levels (
 area TEXT NOT NULL,
 level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 evidence TEXT NOT NULL DEFAULT '{}',
 achieved_at_ms INTEGER NOT NULL,
 PRIMARY KEY(area, level)
) STRICT;
CREATE TABLE achievements (
 id TEXT PRIMARY KEY,
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 evidence TEXT NOT NULL DEFAULT '{}',
 unlocked_at_ms INTEGER NOT NULL
) STRICT;
-- Every new best, so the history of a record can be shown (9.7).
CREATE TABLE personal_records (
 id INTEGER PRIMARY KEY,
 record TEXT NOT NULL,
 value REAL NOT NULL,
 unit TEXT NOT NULL,
 previous REAL,
 attempt_id TEXT,
 session_id TEXT,
 definition_version INTEGER NOT NULL CHECK(definition_version > 0),
 achieved_at_ms INTEGER NOT NULL
) STRICT;
CREATE INDEX personal_records_record ON personal_records(record, achieved_at_ms);
-- This week's three quests, frozen when first shown (9.9). week = local date of the week's first day.
CREATE TABLE weekly_quests (
 week TEXT NOT NULL CHECK(week GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
 slot INTEGER NOT NULL CHECK(slot BETWEEN 1 AND 3),
 quest TEXT NOT NULL,
 params TEXT NOT NULL DEFAULT '{}',
 swapped INTEGER NOT NULL DEFAULT 0 CHECK(swapped IN (0,1)),
 created_at_ms INTEGER NOT NULL,
 completed_at_ms INTEGER,
 PRIMARY KEY(week, slot)
) STRICT;
-- Reflection fields used by level criteria (9.16): your own reading, Your note.
ALTER TABLE transfer_reviews ADD COLUMN flow TEXT CHECK(flow IN ('smooth','mixed','hard'));
ALTER TABLE transfer_reviews ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version=18;
```

---

## 9.1 Journey page and navigation

**Goal.** Give the game layer one home.

**Navigation**
- `nav.ts` gets a new `NavItem`: `{ id: "journey", label: "Journey", to: "/journey", icon: Sprout }` (lucide `Sprout`), placed **after Progress**.
- `AppSidebar` filters it out when `!usePracticeStyle().playful`.
- `activeSection` maps `/journey*` to `journey`.
- In Calm style, Settings → Practice shows the link "Open Journey anyway" (the route always works).

**Routes** (lazy, 7.1)
- `journey`: `JourneyPage`, crumb "Journey".
- `journey/achievements`: `AchievementsPage`, crumb "Achievements".
- Area details open in a sheet using `?area=<id>`, so they can be linked from anywhere.

**Screen** (`src/features/journey/JourneyPage.tsx`, max width 72rem)
```
┌ Journey ─────────────────────────────────────────────────────────────────────┐
│ [Sprout art]  This week: ◔ 2 of 3 days · 180 XP     Lifetime 3,420 XP         │
│               3 weeks in a row · Next: Fluency 2 is 1 take away                │
├ Skill map ───────────────────────────────────────────────────────────────────┤
│ ┌Structure & clarity┐ ┌Fluency──────────┐ ┌Voice & delivery┐ ┌Spontaneity─────┐│
│ │●●○○○ Reason & ex. │ │●●●○○ Steady     │ │●○○○○ Listening │ │●●○○○ Short     ││
│ │next: Clear ending │ │next: Under press│ │next: Endings   │ │next: No notice ││
│ │▓▓▓▓░░ 2 of 3      │ │▓▓░░░░ 1 of 2    │ │▓░░░░░ 1 of 3   │ │▓▓▓▓▓░ 2 of 3  ││
│ └───────────────────┘ └─────────────────┘ └────────────────┘ └───────────────┘│
│ (Vocabulary & phrasing) (Listening & imitation) (Storytelling) (Courage)       │
├ This week's quests ─────────────────────── resets Monday · 1 swap left ──────┤
│ ☐ Answer 2 unfamiliar questions        1 of 2      [Swap]                     │
│ ☑ Review 10 phrases                    done +30 XP                            │
│ ☐ Have one real conversation and note it  0 of 1                              │
├ Recent achievements ───────────── [All achievements] ┬ Personal records ──────┤
│ ★ Said it without notes · 12 Oct                     │ Longest run  14 words  │
│ ★ First unfamiliar question · 9 Oct                  │ Longest take 2:41      │
│ …                                                    │ …                      │
├ Effort ──────────────────────────────────────────────────────────────────────┤
│ XP per week (last 12 weeks, bar chart) · Practice days this month: 9          │
└──────────────────────────────────────────────────────────────────────────────┘
```

**States**
- **Loading:** `LoadingBlock rows={4}`.
- **New user** (no takes): the skill map shows all areas at 0, and level 1 of each area says what to do. The header reads "Your journey starts with your first take."
- **Error:** `ErrorState` with Retry.
- **Calm:** the page still renders when opened directly, with a note: "You're in Calm style. This page isn't in the sidebar."

**Accessibility**
- Each area card is a `button` named, for example, "Fluency, level 3 of 5, Steady. Next: Under pressure, 1 of 2." It opens the sheet.
- The dots are `aria-hidden`.
- The XP chart has an sr-only table.

**Style card.** Switch on `SHOW_STYLE_CARD` (7.5), with its final copy (appendix D).

**Tests** (`JourneyPage.test.tsx`)
- `it("shows the eight areas with level and next step")`
- `it("opens the area sheet from a card and from ?area=")`
- `it("is hidden from the sidebar in calm style but opens directly")`
- `it("explains the empty journey")`

---

## 9.2 Levels engine

**Goal.** A pure, versioned, tested rules engine. It turns facts into:
- the level reached in each area;
- the progress toward the next level;
- the evidence behind both.

The full definitions are in [appendix A](appendix-a-skill-levels.md).

**Files** (all pure TypeScript, no React)
- `src/lib/engagement/types.ts`:
  ```ts
  export const AREA_IDS = ["structure", "fluency", "voice", "spontaneity", "vocabulary", "listening", "storytelling", "courage"] as const;
  export type AreaId = (typeof AREA_IDS)[number];
  export type EvidenceRef = { kind: "session" | "take" | "transfer" | "phrase" | "activity"; id: string; date: string };
  export type CriterionProgress = { met: boolean; done: number; needed: number; label: string; evidence: EvidenceRef[];
    unavailable: { reason: string; fix: "transcription" | "review" | "drills" | "confidence" | "partner" | "events" | null } | null };
  export type LevelStatus = { level: 1 | 2 | 3 | 4 | 5; name: string; state: "reached" | "ready" | "in_progress" | "not_started";
    reachedAt: string | null; criteria: CriterionProgress[] };
  export type AreaStatus = { area: AreaId; current: 0 | 1 | 2 | 3 | 4 | 5; levels: LevelStatus[]; next: LevelStatus | null };
  ```
- `src/lib/engagement/criteria.ts` holds the criteria DSL:
  ```ts
  export type TakeFilter = {
    exercise?: ExerciseType[]; stepKey?: string[];   // drills and other activities are exercise types (D-30)
    familiarity?: Familiarity; maxPrepSeconds?: number; minSpeechMs?: number; audience?: boolean; followUp?: boolean;
    tags?: string[]; promptTags?: PromptTag[]; noOutline?: boolean; transcribed?: boolean; fillersReviewed?: boolean; prosodyViewed?: boolean;
    check?: { id: SelfCheckId; value: boolean };
    metric?: { key: NumericFactTakeKey; op: "<=" | ">="; value: number | { baseline: "first5ReviewedMedian"; factor: number } };
    firstTakeOnly?: boolean;
  };
  export type Criterion =
    | { kind: "takes"; label: string; filter: TakeFilter; atLeast: number; distinctDays?: number }
    | { kind: "sessions"; label: string; filter: Omit<TakeFilter, "metric" | "check" | "stepKey"> & { minTakes?: number; outline?: ("point" | "reason" | "example")[]; focusIn?: string[] };
        atLeast: number; distinctDays?: number; distinct?: "focus" | "contentId" }
    | { kind: "transfers"; label: string; listenerWords?: boolean; noClarification?: boolean; flow?: "smooth"[]; tags?: string[]; mission?: boolean; atLeast: number; distinctWeeks?: number }
    | { kind: "phrases"; label: string; saved?: number; reviews?: number; reviewDays?: number }
    | { kind: "phraseUses"; label: string; takes?: number; distinctPhrases?: number; unfamiliarOnly?: boolean }
    | { kind: "activity"; label: string; type: ExerciseType; atLeast: number; distinctDays?: number; result?: { key: string; op: ">=" | "<="; value: number } }
    | { kind: "exposure"; label: string; steps: number; minBefore?: number }                 // facts from M12
    | { kind: "conversation"; label: string; minTurns: number; atLeast: number; minPressure?: 0 | 1 | 2 | 3 }   // facts from M13
    | { kind: "listenerAnswers"; label: string; atLeast: number; mainPointAnswered?: boolean } // facts from M14
    | { kind: "debrief"; label: string; atLeast: number }                                    // facts from M14
    | { kind: "anyOf"; label: string; options: Criterion[] }
    | { kind: "allOf"; label: string; parts: Criterion[] };
  export function progressOf(c: Criterion, facts: PracticeFacts, ctx: EvalContext): CriterionProgress
  /** promptTags: each prompt ID's tags (from listPrompts), so criteria can ask for e.g. storytelling prompts. */
  export type EvalContext = { today: string; baselines: Baselines; promptTags: Record<string, PromptTag[]> };
  /** Derived values, e.g. confirmedPer100 = fillersConfirmed × 100 ÷ words (null under 20 words or when not fully reviewed). */
  export function metricOf(take: FactTake, key: NumericFactTakeKey): number | null
  export type Baselines = { first5ReviewedMedian: Partial<Record<NumericFactTakeKey, number>> };
  export function computeBaselines(facts: PracticeFacts): Baselines
  ```
  **Rules of the DSL**
  - **Counting:**
    - `atLeast` counts matching items;
    - `distinctDays` adds a second requirement: the matches span at least that many local dates;
    - `done` is the smaller count against its own `needed`, so "2 of 3 takes, on 1 of 2 days" shows two criteria lines.
  - **Missing facts.** A criterion whose facts don't exist yet (for example `activity` before M10, `exposure` before M12) returns `unavailable`, with `fix` naming what brings it ("Arrives with Drills").
    - Inside `anyOf`, the first available option shows.
    - An `anyOf` is met when any option is met.
  - **Metric criteria** never pass on a `null` value. A take with a missing value doesn't count, and the criterion's label says so: "Only takes with timings count".
  - **Baseline** `first5ReviewedMedian`:
    - it is the median of the metric over your first five takes with `fillersReviewed`;
    - with fewer than five, the criterion is `unavailable`: "Review 5 takes to set your starting point", with `fix: "review"`;
    - its `done` counts the reviewed takes so far.
  - **No AI fields.** The DSL has no field that reads AI feedback (`hasAiFeedback` is not a `NumericFactTakeKey`). P-7 / A-29 is enforced by the type.
- `src/lib/engagement/skills.ts` holds the definitions:
  ```ts
  export const LEVEL_DEFINITIONS_VERSION = 1;
  export type AreaDef = { id: AreaId; title: string; short: string; trains: string; icon: LucideIcon };
  export const AREAS: readonly AreaDef[];                       // appendix A, table "Areas"
  export type LevelDef = { level: 1|2|3|4|5; name: string; description: string; criteria: Criterion[]; practise: PractiseLink[] };
  export const LEVELS: Readonly<Record<AreaId, readonly LevelDef[]>>;   // appendix A, 40 entries
  export type PractiseLink = { label: string; to: string; exerciseType?: ExerciseType };
  ```
- `src/lib/engagement/evaluate.ts`:
  ```ts
  /** Levels are earned in order. A higher level whose criteria are already met shows as "ready" and is recorded right after the one below it. */
  export function evaluateAreas(facts: PracticeFacts, reached: StoredLevel[], ctx: EvalContext): AreaStatus[]
  export type EngagementDiff = { levels: NewLevel[]; achievements: NewAchievement[]; records: NewRecord[]; questsDone: { week: string; slot: number }[]; weeklyGoal: string | null };
  export function evaluate(facts: PracticeFacts, events: PracticeEvent[], state: EngagementState, prefs: Pick<Preferences, "weeklyGoalDays" | "weekStartsOn">): EngagementDiff
  ```
  **Rules**
  - **Stored levels always count as reached,** even if their facts were purged later (A-28).
  - **Evidence is kept small:** the `evidence` saved for a new level is the IDs that met the criteria, at most 10 per criterion.
  - **A definitions change** (a version bump) never removes a stored level. The next levels use the new criteria.

**Tests** (`src/lib/engagement/criteria.test.ts`, `evaluate.test.ts`, using `factsBuilder` and `withFakeToday`)
- `it("counts takes that match every filter field")`: one test per field, table-driven.
- `it("requires distinct days separately from the count")`
- `it("never passes a metric criterion on a missing value")`
- `it("asks for five reviewed takes before a baseline criterion can progress")`
- `it("anyOf shows the first available option and is met by any")`
- `it("reports unavailable criteria with the feature that brings them")`
- `it("earns levels in order and marks a met higher level as ready")`
- `it("keeps stored levels even when their sessions are gone")` (part of A-28)
- `it("never reads AI feedback")` (A-29): the facts have `hasAiFeedback: true` on every take and no other evidence, and no level progresses. The test also checks that `criteria.ts` contains no `hasAiFeedback` reference, with `readFileSync` in Node (allowed in Vitest).
- **Golden test** `it("matches the golden journey for the sample history")`: `src/lib/engagement/__golden__/sample-history.json` (facts) → `expected-areas.json`. Update it deliberately with `UPDATE_GOLDEN=1`.
- **Definition sanity** (`skills.test.ts`):
  - every area has exactly 5 levels;
  - names are unique;
  - every criterion has a label;
  - `needed ≥ 1`;
  - every `practise` link points to an existing route or activity;
  - level `n+1` is never easier than level `n` on the same counted dimension (a simple check: the same filter with a lower `atLeast` is flagged).

**As built (17 Oct)**
- The criteria are typed data in `src/lib/engagement/criteria.ts`; kinds that need a later milestone (drills, missions, the confidence pack, the conversation partner, events) report `unavailable` with a reason and a fix ("Arrives with Drills") instead of counting as unmet; so do criteria waiting for your first five reviewed takes or for local transcription. An `anyOf` shows its first available option; an `allOf` is unavailable while any part is.
- Baselines (the median of your first five reviewed takes) are computed once per evaluation (`computeBaselines`).
- Golden files: `src/lib/engagement/__golden__/sample-history.json` and `expected-areas.json`; the test writes them when they are missing or with `UPDATE_GOLDEN=1`, so a deliberate change is reviewed as a diff.

---

## 9.3 Engagement storage

**Goal.** Record what you earned, once, safely. XP for these unlocks is awarded in the same transaction.

**Native** (`src-tauri/src/storage/engagement.rs`, commands in `commands/engagement.rs`)
```rust
pub const AREAS: [&str; 8] = ["structure","fluency","voice","spontaneity","vocabulary","listening","storytelling","courage"];
pub const RECORDS: [(&str, &str); 12] = [("longest_take","s"), ("longest_run","words"), ("mean_run_unfamiliar","words"), ("different_per_50","words"),
    ("fewest_confirmed_per_100_unfamiliar","per 100 words"), ("jam_clean_seconds","s"), ("word_bomb_woven","words"), ("pace_range","syll/s"),
    ("emphasis_hits","sentences"), ("gauntlet_rounds","rounds"), ("conversation_turns","turns"), ("phrases_in_one_take","phrases")];
#[derive(Serialize)] #[serde(rename_all="camelCase")]
pub struct EngagementState { pub levels: Vec<LevelRow>, pub achievements: Vec<AchievementRow>, pub records: Vec<RecordRow>,
    pub quests: Vec<QuestRow> /* this week and last week */, pub goal_weeks: Vec<String> /* weeks with a weekly_goal event */ }
#[derive(Deserialize)] #[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct UnlockInput { pub levels: Vec<NewLevel>, pub achievements: Vec<NewAchievement>, pub records: Vec<NewRecord>,
    pub quests_done: Vec<QuestRef>, pub weekly_goal: Option<String>, pub local_date: String }
impl DatabaseOwner {
    pub fn engagement_state(&self, week: &str) -> Result<EngagementState>;
    /// Validates and inserts every unlock once (INSERT OR IGNORE), awarding XP events:
    /// level_reached (ref "area:level"), achievement (ref id), personal_record (ref "record:row id"),
    /// quest (ref "week:slot"), weekly_goal (ref week). Returns what was actually new.
    pub fn record_unlocks(&self, input: &UnlockInput) -> Result<UnlockOutcome>;
    pub fn set_weekly_quests(&self, week: &str, quests: &[QuestInput]) -> Result<Vec<QuestRow>>;   // insert-if-absent per slot
    pub fn swap_weekly_quest(&self, week: &str, slot: u8, quest: &QuestInput) -> Result<QuestRow>; // once per week, not when completed
}
```

**Validation.** Each rule gives a plain error message.
- **Levels:**
  - the area is in `AREAS`;
  - the level is 1–5;
  - level n needs n−1 stored or present earlier in the same input.
- **Achievement IDs** match `^[a-z0-9-]{3,40}$`. The catalogue lives in TypeScript.
- **Records:**
  - the record ID and unit are from `RECORDS`;
  - the value is finite and ≥ 0;
  - it is better than the stored best (higher, or lower for `fewest_…`), otherwise it is ignored.
- **Evidence** JSON:
  - at most 4 KB;
  - only arrays of IDs and numbers (checked recursively).
- **Weeks** are a valid date that is a Monday or a Sunday.

**IPC**
- `getEngagementState(week)`, `recordUnlocks(input)`, `setWeeklyQuests(week, quests)` and `swapWeeklyQuest(week, slot, quest)`.
- Schemas: `EngagementState`, `UnlockInput`, `UnlockOutcome`, `LevelRow`, `AchievementRow`, `RecordRow`, `QuestRow`.
- Key: `keys.engagementState(week)`.
- The mock keeps the same structures in memory with identical validation (a shared `validateUnlockInput` in `src/lib/engagement/validate.ts`, used only by the mock; Rust is authoritative natively).

**Tests**
- Rust:
  - `record_unlocks_inserts_once_and_awards_xp_once`;
  - `levels_must_be_recorded_in_order`;
  - `records_only_store_improvements_and_keep_history`;
  - `quests_are_frozen_per_week_and_swappable_once`;
  - `evidence_with_text_is_refused` (A-30);
  - `ledgers_survive_permanent_deletion` (A-28, `acceptance::a28_ledgers_survive_purges`).
- Vitest: `mock-client.test.ts` `it("validates unlocks like the native core")`.

**As built (17 Oct)**
- The native side is `src-tauri/src/storage/game.rs` (not `storage/engagement.rs`, which keeps the ledger and facts from M7); commands are `get_engagement_state(week)`, `record_unlocks(input)`, `set_weekly_quests(week, quests)` and `swap_weekly_quest(week, slot, quest)`.
- `record_unlocks` validates everything before one transaction: a level needs the one below it, evidence holds IDs, dates and numbers only (4 KB, depth below 6), a record's first value is stored silently with no XP, and a tie is not a record.
- Facts v3 add `userPrompts`, `blindComparisons` and each real-conversation reflection's `flow` and `tags` (fixture `src/lib/ipc/fixtures/facts-v3.json`).
- Downgrade fixtures and snapshots follow the v17 pattern (`before-v18-`).

---

## 9.4 `EngagementProvider`: the refresh loop

**Goal.** One place runs the evaluation after anything that could change it, records the new unlocks, refreshes views and queues celebrations.

**Front end**
- `src/features/engagement/EngagementProvider.tsx`, mounted in `AppShell` inside the `IpcContext` and `QueryClientProvider`:
  ```ts
  type EngagementApi = {
    refresh(reason: RefreshReason): void;          // debounced 400 ms, single-flight; a refresh during a run queues one more
    lastDiff: EngagementDiff | null;               // for Today you earned
    earnedToday: EarnedSummary;                    // XP today, unlocks today (from events and state)
  };
  export type RefreshReason = "start" | "take" | "transcript" | "review" | "reflection" | "phrase" | "activity" | "manual";
  export function useEngagement(): EngagementApi
  ```
- **Steps** (see the README, §6.4):
  1. `getPracticeFacts`, `listPracticeEvents(from = 15 weeks ago)` and `getEngagementState(week)` in parallel.
  2. `ensureWeeklyQuests` (9.9).
  3. `evaluate()`.
  4. If the diff is not empty, call `recordUnlocks`.
  5. `invalidateQueries({ queryKey: ["engagement"] })`.
  6. `celebrations.enqueue(outcome)`, unless the reason is `"start"` or the style is Calm.
- **Triggers**
  - App start: `"start"`, so nothing celebrates.
  - **Studio:** after a take is saved (the `rec.takes.length` effect): `"take"`.
  - **Transcription queue** (`queue.tsx`): when a job finishes: `"transcript"`.
  - **Mutations:** every mutation that can change facts sets `meta: { engagement: "review" | "reflection" | "phrase" | "activity" }`. The provider subscribes to `queryClient.getMutationCache()` and calls `refresh(meta.engagement)` on success.

    Mutations to tag:
    - `setFillerDecision`;
    - `setSessionReflection`;
    - `addTransferReview`;
    - `reviewPhrase`;
    - `addPhrase`;
    - `setSelfCheck`;
    - later, every M10–M14 mutation.
- **Errors** are logged to the console in development only. They never show a toast, and they retry on the next trigger, because the game layer must never block practice.

**Tests** (`EngagementProvider.test.tsx`)
- `it("records new unlocks once and invalidates engagement queries")`
- `it("debounces bursts into one evaluation")`
- `it("does not celebrate on start")`
- `it("refreshes after a tagged mutation succeeds")`
- `it("keeps working when the engagement call fails")`

**As built (17 Oct)**
- Errors are swallowed without logging (the no-logging test forbids `console` in app code); the next trigger simply tries again.
- One pass reads facts, all events, the state and your prompts in parallel, chooses the week's quests if the week has none, evaluates, and writes once. Achievements see the levels and goal weeks recorded in the same pass, so nothing appears one refresh late.
- Triggers: tagged mutations (`meta.engagement`), a saved take, a finished transcript, Practice complete and a saved intonation review.

---

## 9.5 XP display

**Goal.** Make effort visible without noise.

**Rules**
- **XP values** come from `practice_events.xp` (Rust is the source; see appendix B).
- **"This week"** sums `xp` for events whose `local_date` falls in the current week (`weekStartsOn`). **"Lifetime"** sums all events.
- **Backfilled events count** toward lifetime and their own weeks.

**Front end**
- `src/lib/engagement/xp.ts`:
  - `weekXp(events, weekStart)`;
  - `lifetimeXp(events)`;
  - `xpByWeek(events, weeks = 12, startsOn)`, which returns `{ week, xp }[]`;
  - `XP_REASONS: Record<string, string>`, for example `take_saved` → "Take saved".
- **Take-saved toast** (Studio): in Playful style, the existing `toast.success("Take 2 saved")` becomes "Take 2 saved · +15 XP".
  - The XP is read from the events after the save. If they aren't loaded yet, no suffix shows.
  - There is no extra toast.
- **Journey header:** this week's and lifetime XP, plus the 12-week bar chart (Recharts `BarChart`, axis font 13).
  - Each bar has a tooltip: "Week of 6 Oct: 240 XP".
  - An sr-only table repeats the data.
- **Journey → "How XP works"** `<details>` lists the XP table in plain words (appendix B), with the line: "XP rewards practising. It never measures how you sound."

**Tests**
- `xp.test.ts`:
  - `it("sums this week from the week's first day")`;
  - `it("includes backfilled events")`.
- Studio test: `it("adds the XP to the saved toast in playful style only")`.

---

## 9.6 Achievements

**Goal.** Meaningful badges for firsts, consistency, courage and craft. There are about 40, all visible, with no hidden ones, so they are goals as well as rewards. The catalogue is in [appendix B](appendix-b-rewards.md).

**Files**
- `src/lib/engagement/achievements.ts`:
  ```ts
  export const ACHIEVEMENTS_VERSION = 1;
  export type AchievementDef = { id: string; title: string; description: string; category: "start" | "habit" | "craft" | "courage" | "explore" | "phrases" | "listening" | "real";
    icon: LucideIcon; criterion: Criterion | { kind: "custom"; test: (f: PracticeFacts, s: EngagementState, events: PracticeEvent[]) => CriterionProgress } ; unlocksAccent?: AccentId; unlocksPot?: PotId };
  export const ACHIEVEMENTS: readonly AchievementDef[];
  export function newAchievements(facts, state, events, ctx): NewAchievement[]
  ```
- `src/features/journey/AchievementsPage.tsx`, at `/journey/achievements`:
  - a grid grouped by category;
  - each card shows the icon, title, description, and either "Unlocked 12 Oct" or progress ("2 of 3");
  - locked cards are dimmed (opacity 0.6, still readable at ≥ 4.5:1);
  - a filter: All · Unlocked · In progress.

**Tests**
- `achievements.test.ts`:
  - `it("every achievement has a unique id, title, icon and a criterion")`;
  - `it("unlocks First take after one saved take")`;
  - `it("Comeback needs fourteen days away")`;
  - `it("Said it without notes needs a 60-second take with no outline")`.
- `AchievementsPage.test.tsx`:
  - `it("groups, filters and shows progress")`;
  - `expectNoScores`.

**As built (17 Oct)**
- The catalogue holds the achievements M9 can award from its own facts; the drill, mission and learning-engine ones join with their milestones, so nothing shown is impossible to earn yet.
- Locked cards use a dashed border on a transparent card instead of opacity, which keeps text contrast in dark mode.
- The tests live in `src/lib/engagement/rewards.test.ts` (achievements, records and quests together) and `src/features/journey/JourneyPage.test.tsx`.

---

## 9.7 Personal records

**Goal.** Strava-style personal bests, always against your own past. Records are listed in [appendix B](appendix-b-rewards.md), each with its eligibility rule.

**Rules**
- **A record needs a previous value to count as "new".** The first eligible value is stored silently as the starting point, with `previous` NULL and no celebration.
- **Ties** are not new records.
- **The direction is per record:** higher is better, or lower for the single `fewest_…` record.
- **The filler record is shown low-key.** `fewest_confirmed_per_100_unfamiliar` only counts takes with ≥ 60 s of speech, every candidate reviewed, and an unfamiliar topic. It is shown in the Fluency area sheet and Records, but **never celebrated with a card**, only a toast. This avoids turning fillers into a target (blueprint §7: "Do not infer progress solely from a lower filler count").

**Files**
- `src/lib/engagement/records.ts`:
  ```ts
  export type RecordDef = { id: RecordId; title: string; unit: string; better: "higher" | "lower"; format: (v: number) => string;
    eligible: (t: FactTake, s: FactSession) => boolean; value: (t: FactTake, s: FactSession) => number | null; celebrate: "card" | "toast" };
  export const RECORDS: readonly RecordDef[];
  export function newRecords(facts: PracticeFacts, stored: RecordRow[]): NewRecord[]   // only takes newer than the stored best's time
  ```
- **The take summary** shows the line "New personal record: longest run 14 words (previous 11, 3 Oct)" in Playful style.
- **Journey → Records** lists each record with its value and date and a link to the take. "History" opens a small chart of every previous best.

**Tests** (`records.test.ts`)
- `it("stores the first value silently and celebrates only improvements")`
- `it("ignores ties and ineligible takes")`
- `it("the filler record needs a fully reviewed unfamiliar take of 60 seconds")`

---

## 9.8 Weekly goal and weeks in a row

**Goal.** A forgiving habit target: practise on N days of each week (default 3). Missing a day never breaks anything. Habit research found that a missed day didn't derail habit formation (Lally et al. 2010).

**Rules** (`src/lib/engagement/weekly.ts`)
```ts
export function weekStart(localDate: string, startsOn: "monday" | "sunday"): string
export function weekDays(weekStart: string): string[]                    // 7 local dates
/** A practice day has at least one take_saved, transfer_review, exposure_step (M12) or drill_round (M10) event. */
export function practiceDays(events: PracticeEvent[], weekStart: string): string[]
export function goalProgress(events, weekStart, goalDays): { days: number; goal: number; met: boolean }
/** Consecutive weeks with the goal met, counting back from last week (this week counts once met). */
export function weeksInARow(goalWeeks: string[], currentWeek: string, metThisWeek: boolean, startsOn): number
```
- **A met week is recorded** via the `weekly_goal` event (`recordUnlocks.weeklyGoal`). It stays met if you later change the goal.
- **Changing the goal** applies to the current week from that moment.

**Settings** (Practice section)
- A **Weekly goal** `Select`: 1–7 days, with the hint "Rest days are part of practice. The goal resets each week; nothing is lost."
- A **Week starts on** `Select`: Monday or Sunday.

**WeekRow** (`src/features/today/WeekRow.tsx`), Playful style:
- A ring around the summary shows "2 of 3 days". At ≥ 2 weeks in a row, it adds "· 3 weeks in a row".
- Days without practice show as plain hollow dots, never red, never crossed out.
- Calm style keeps today's version.

**Tests**
- `weekly.test.ts`:
  - `it("computes week starts for Monday and Sunday weeks across month and year ends")`;
  - `it("counts a practice day once however many takes")`;
  - `it("weeks in a row skips nothing and counts this week once met")`;
  - `it("a goal met stays met after the goal changes")`.
- `WeekRow.test.tsx`: `it("shows the goal ring in playful style and plain dots in calm")`.

---

## 9.9 Weekly quests

**Goal.** Three small, varied goals each week, chosen with a visible reason, with one swap. Quest templates are in [appendix B](appendix-b-rewards.md).

**Rules** (`src/lib/engagement/quests.ts`)
```ts
export type QuestTemplate = { id: string; title: (p: QuestParams) => string; reason: (ctx) => string; area: AreaId | null;
  needs: (facts) => boolean /* e.g. drills exist */; progress: (facts, events, weekStart, p) => { done: number; needed: number } };
export function generateWeeklyQuests(facts, areas: AreaStatus[], events, weekStart, recentQuests: QuestRow[]): QuestInput[]  // 3 slots
export function questProgress(q: QuestRow, facts, events): { done: number; needed: number; met: boolean }
```
- **Slot 1: your area with the least practice.** Pick the lowest current level; break ties with the fewest sessions in that area over the last 30 days. Choose a template for that area.
  - Reason, for example: "Voice & delivery has had the least practice this month."
- **Slot 2: the real world.** `real-1`, or a mission once M14 exists.
- **Slot 3: variety.** A template not used in the last three weeks. It leans toward the monthly theme's area (9.13), and toward a drill not played in 30 days once M10 exists.
- **Determinism.** Generation is deterministic for a given week (`seededRandom(weekStart)`), but is stored when first shown, so later fact changes never reshuffle it.
- **Swap.** One swap per week replaces a slot with the next eligible template.
- **Completion** is detected by the evaluator and recorded with `questsDone`, worth 30 XP each.

**UI**
- In the Journey section and the Today strip, each quest shows a checkbox-like state icon (not an input), its title, progress "1 of 2" and a **Swap** button.
- Swap is disabled after one swap or once the quest is completed.
- The reason is in a tooltip, plus a visible "Why?" disclosure for keyboard users.

**Tests** (`quests.test.ts`)
- `it("fills three slots with weakest area, real world and variety")`
- `it("is deterministic for a week")`
- `it("never repeats a template from the last three weeks in slot 3")`
- `it("detects completion from this week's facts only")`
- Rust: covered in 9.3.

**As built (17 Oct)**
- A quest's "Why?" reason is built from its stored params (`questReason`), so it reads the same after a reload.
- Swap offers one different quest (`swapCandidate`), once a week, never for a completed one; the native core refuses a second swap too.

---

## 9.10 Celebrations

**Goal.** Make reaching something feel good, briefly, then get out of the way (§8.5 of the README).

**Files**
- `src/features/engagement/celebrations.ts`:
  ```ts
  export type Celebration =
    | { kind: "level"; area: AreaId; level: number; name: string; because: string }
    | { kind: "achievement"; id: string; title: string; description: string }
    | { kind: "record"; title: string; value: string; previous: string | null; quiet: boolean }
    | { kind: "weeklyGoal"; days: number; goal: number; weeksInARow: number }
    | { kind: "quest"; title: string }
    | { kind: "companion"; stage: number };
  export function celebrationsFrom(outcome: UnlockOutcome, defs): Celebration[]   // ordered: level, weeklyGoal, achievement, record, quest, companion
  ```
- `src/features/engagement/CelebrationHost.tsx`, mounted in `AppShell`:
  - **Full style:** a card in the bottom-right corner (`role="status"`, `aria-live="polite"`), 360 px wide.
    - It shows a level-dots or ring animation (`animate-ring-fill`, 500 ms), the title, the "because" line, and two buttons: **See in Journey** and **Close**.
    - It closes by itself after 8 s unless it has hover or focus. Esc closes it.
    - It never moves focus.
  - **Subtle style** (or reduced motion): a sonner toast with the title and a "Journey" action.
  - **Off:** nothing.
  - **Queue:** one at a time with 1.2 s gaps, at most three per refresh, then "And 2 more in Journey".
  - **Deferral:** subscribes to `ipc.onRecordingEvent` and holds the queue while a take is preparing, recording or finalizing, while a drill clock runs (`useDrillClock` sets a global `busy` flag via a small store), and while a dialog is open.
  - **Sound:** if `celebrationSounds` is on, `playCue("celebrate")`, a two-note soft chime added to `src/lib/tone.ts`.
- **Copy** comes from appendix D. "Because" lines describe the task ("Three takes where pauses took the place of most hesitations"), never the person.

**Tests** (`CelebrationHost.test.tsx`)
- `it("shows one card at a time in order")`
- `it("waits while recording and shows after the take is saved")`
- `it("uses a toast under reduced motion and nothing when off")`
- `it("summarises more than three")`
- `it("never takes focus and closes with Escape")`
- A-37: `a37-motion.test.tsx` checks the `animate-*` classes are absent under reduced motion.

**As built (17 Oct)**
- More than three in one batch becomes three plus "And N more in Journey". A quiet record's headline is clipped at 90 characters.
- The card waits while a take is recording and while a dialog is open; Escape is caught in the capture phase so a toast can't swallow it.

---

## 9.11 Companion: Sprout

**Goal.** A small plant that grows as you practise, like Finch or Forest. It **never wilts, never gets sad, never shrinks.** Optional, and on by default in Playful style.

**Rules**
- **Growth stage** is set by practice days, not XP (no grinding).
- The stages are: 0 seed · 1 sprout (1 day) · 2 two leaves (3) · 3 young plant (7) · 4 bushy (14) · 5 bud (30) · 6 flower (60) · 7 small tree (100) · 8 blossoming tree (180).
- **Seasonal touch:** leaf tint by month (cosmetic, from the accent ramp).
- **Pots** unlock with some achievements: clay (default), white glaze, blue glaze, wood, stone. Choose one in Journey → Sprout → Pot.

**Front end**
- `src/features/journey/Companion.tsx`: `Companion({ stage, pot, size }: { stage: 0..8; pot: PotId; size: 64 | 120 })`.
  - It is inline SVG: one `<g>` per growth part, revealed by stage.
  - A gentle 6 s sway loops only while it is on screen and not under reduced motion.
  - `aria-label`: "Sprout, a small plant at stage 4 of 8. It grows with your practice days."
- `stageForDays(days: number): number` lives in `src/lib/engagement/companion.ts`.
- A growth stage reached is a `companion` celebration (subtle toast: "Sprout grew a new leaf").
- It appears in the Journey header and in Today you earned.
- Settings → Practice → **Companion** `Switch`.

**Tests**
- `companion.test.ts`: `it("maps practice days to stages")`.
- `Companion.test.tsx`: `it("renders every stage with a label")`.
- Visual check of all 9 stages in both themes, as screenshots in the PR description.

**As built (17 Oct)**
- Sprout's colours are tokens (`--cp-sprout-*`, `--cp-pot-*` in `src/index.css`), with dark values.
- It sways only while on screen (IntersectionObserver) and never under reduced motion (covered by A-37).

---

## 9.12 Accent colours

**Goal.** Cosmetic rewards. Appearance stays available in Calm style.

**Rules.** Six accents. Five unlock through an achievement (appendix B); unlocked accents stay unlocked.

| Accent | Unlocks with |
| --- | --- |
| green | default |
| ocean | first weekly goal |
| amber | 10 practice days |
| violet | first level 3 in any area |
| rose | first real-conversation reflection |
| graphite | 30 practice days |

**Front end**
- `src/index.css`: `[data-accent="ocean"] { --cp-accent: …; --cp-accent-foreground: …; --cp-level-1..5: … }`, with light and dark sets.
- `theme.tsx`: `setAccent(id)` sets `document.documentElement.dataset.accent`.
- Settings → Appearance → **Accent colour**: radio swatches (40 px) with names. Locked swatches show a lock icon and "Unlocks with: first weekly goal", and are disabled.

**Tests**
- `src/app/accents.test.ts`: `it("every accent keeps text contrast of at least 4.5:1 in light and dark")`. It parses `src/index.css` with a small regex for the accent blocks and computes WCAG contrast.
- `it("locked accents cannot be chosen")`.

---

## 9.13 Monthly themes and fresh starts

**Goal.** Use natural fresh-start moments (Mondays, the 1st of the month, coming back after a break) to restart motivation (Dai, Milkman & Riis 2014), with no pressure.

**Content.** `src/content/monthly-themes.ts`: `MONTHLY_THEMES: Record<1..12, { title: string; area: AreaId; note: string }>`, for example 10 → "Storytelling month", `storytelling`. The full list is in appendix C.

**Rules**
- **First seven days of a month:** the Journey header and the Today strip show "October: Storytelling month. Quests lean toward stories."
- **Monday:** "New week. Three quests are ready."
- **After 14 or more days without practice:** "Welcome back. Today's plan is short; pick up where it feels right." The session length defaults to Short for that day only; you can change it. This also unlocks the `comeback` achievement.

**Tests**
- `fresh-start.test.ts`: `it("picks the right note for Mondays, month starts and comebacks")`.
- `it("defaults to the short plan once after a break")`.

---

## 9.14 Today strip and Today you earned

**Today strip.** `src/features/journey/JourneyStrip.tsx`, in the Today aside, above `StagePanel`, Playful style only:
```
┌ This week ───────────────────────────┐
│ ◔ 2 of 3 days · 180 XP   [Sprout 48] │
│ ☐ Answer 2 unfamiliar questions 1 of 2│
│ ☑ Review 10 phrases                   │
│ ☐ Have one real conversation          │
│ Next: Fluency 2 · 1 more reviewed take│
│ [Open Journey]                        │
└───────────────────────────────────────┘
```
- **"Next"** is the area level closest to completion, by the highest done/needed ratio among in-progress levels.
- It links to the area sheet.

**Today you earned.** `src/features/journey/EarnedToday.tsx`, on `CompletionPage`, between the stats and "Before you go", Playful style only:
```
┌ Today you earned ──────────────────────────────┐
│ +85 XP · Week: 3 of 3 days, goal reached        │
│ ● Fluency reached level 2 · Replacing            │
│ ★ Said it without notes                          │
│ ↑ Longest run 14 words (previous 11)             │
│ [Sprout] grew a new leaf                         │
└──────────────────────────────────────────────────┘
```
- **Data:** today's events plus the unlock rows with today's date.
- **Refresh:** the panel waits for the provider's refresh triggered by `recordSequenceCompleted`.
- **Empty case:** if nothing new beyond XP, it shows "+40 XP · Week: 2 of 3 days".

**Tests**
- `JourneyStrip.test.tsx`:
  - `it("shows goal, quests and the nearest next level")`;
  - `it("is absent in calm style")`.
- `EarnedToday.test.tsx`:
  - `it("lists today's unlocks in order")`;
  - `expectNoScores`.

**As built (17 Oct)**
- The strip's heading is "Journey this week", because Today's plan already has a "This week" region and two regions must not share a name.
- The area suggestion ("Give Voice & delivery five minutes today") sits in the strip (`areaSuggestion` in `src/lib/scheduler.ts`) rather than in Today's plan.
- After 14 days away, Today offers the short length by default and the strip shows the fresh-start note.

---

## 9.15 Area sheet, Practise this, soft locks

**Area sheet.** `src/features/journey/AreaSheet.tsx`, a shadcn `Sheet` from the right, 480 px wide (full width on narrow screens):
```
┌ Fluency ──────────────────────────────────────────── [×] ┐
│ Fewer hesitations and steadier flow. Hesitation is normal │
│ in a second language; this area trains noticing and       │
│ pausing instead.                                          │
│ ● Level 1 · Aware          Reached 2 Oct                  │
│ ● Level 2 · Replacing      Reached 12 Oct  ▸ evidence     │
│ ◐ Level 3 · Steady         In progress                    │
│    ☐ A 60-second take on a familiar topic with no pause   │
│      inside a clause of 1.5 s or more       1 of 2        │
│    Only takes with timings count.                          │
│    [Record a familiar answer]  [Play Just a Minute]       │
│ ○ Level 4 · Under pressure Not yet                        │
│ ○ Level 5 · Natural        Not yet                        │
│ How levels work ▸                                          │
└──────────────────────────────────────────────────────────┘
```
- **Evidence** expands to a list of the sessions or takes, as links.
- **Unavailable criteria** show their fix:
  - "Needs local transcription. [Set it up]" goes to `/settings/transcription`;
  - "Arrives with Drills" shows plain text.
- **"How levels work"** says: "Levels show what you've practised and shown, never a grade of your English. AI suggestions don't count. A level you reach is never taken away."

**Soft locks.** `src/lib/engagement/unlocks.ts`:
```ts
export const RECOMMENDED_AFTER: Record<string /* activity or boss id */, { area: AreaId; level: number }>;
export function recommendation(itemId: string, areas: AreaStatus[]): { area: AreaId; level: number; met: boolean } | null
```
- **Cards** (drills, boss levels) whose recommendation isn't met show a lock-open icon and "Recommended after Spontaneity 3 · Try anyway". They are always playable.
- **Calm style** shows no lock text.

**Scheduler.** `scheduler.ts` gains one suggestion source:
- in Playful style, "Give *Voice & delivery* five minutes today: *Listen and imitate*";
- with the reason "It has had the least practice in the last 30 days";
- from M10 on, drills are suggested.

It stays rules-based, with a reason, and can be overridden.

**Tests**
- `AreaSheet.test.tsx`:
  - `it("shows reached levels with dates and the next level's criteria with progress")`;
  - `it("links unavailable criteria to their fix")`.
- `unlocks.test.ts`: `it("never blocks, only recommends")`.
- `scheduler.test.ts`: `it("suggests the least-practised area with its reason")`.

---

## 9.16 Reflection fields: flow and kind

**Goal.** Two optional fields in the real-conversation reflection feed the Fluency 5, Storytelling 5 and Structure 5 criteria. Both are Your note.

**Front end.** In `ProgressPage.tsx` `RealConversations`, the form gets:
- **"How did your speaking flow?"**, a `ToggleGroup` with Smoothly · Mixed · With effort;
- **"What kind of conversation?"**, chips: Story · Meeting · Presentation · Interview · Small talk · Phone call · Other (multi-select).

Saved as `flow` and `tags`. The `Reflection` card shows them with the Your note label.

**Native**
- `TransferInput` and `TransferReview` gain `flow: Option<String>` and `tags: Vec<String>`. Tags are validated against the list.
- Facts: `FactTransfer.flow` and `FactTransfer.tags`.

**Tests**
- Rust: `transfer_reviews_store_flow_and_known_tags_only`.
- Vitest: `it("saves flow and kind with the reflection")`.

**As built (17 Oct)**
- The kinds are stored as `tags` (story, meeting, presentation, interview, small_talk, phone, other), de-duplicated and checked natively; the flow is checked by the column's `CHECK`.
- The reflection card shows both with the Your note label.

---

## Manual recipe: a week of play (packaged build)

1. **Monday: pick a style.**
   1. Install the build and open the app.
   2. Choose **Keep it playful** on the style card.
   3. **Observe:** Journey appears in the sidebar. Today shows the strip with three quests and "New week".
2. **Record.**
   1. Record two takes in the Studio.
   2. **Observe:** the saved toasts say "+10 XP" and "+15 XP". No celebration appears while recording.
3. **Transcribe and review.**
   1. Transcribe one take and review every hesitation candidate.
   2. **Observe:** a quiet toast for the achievement "First review", and Fluency shows "1 of 3".
4. **Finish the sequence.**
   1. Finish today's sequence.
   2. **Observe:** Practice complete shows Today you earned.
5. **Reach the weekly goal.**
   1. Change the system date, or practise on two more days.
   2. **Observe:** the weekly goal card shows once. WeekRow shows "3 of 3 days".
6. **Check Trash.**
   1. Move a session that earned something to Trash, and empty Trash.
   2. **Observe:** XP, levels and achievements are unchanged, and the evidence link says "from a deleted session".
7. **Switch to Calm.**
   1. Switch to Calm in Settings.
   2. **Observe:** Journey, the strip, XP suffixes and celebrations are gone. Switch back and everything returns.
8. **Reduced motion.**
   1. Turn on Windows → Accessibility → Visual effects → Animation effects off.
   2. **Observe:** celebrations are toasts, and Sprout doesn't sway.
