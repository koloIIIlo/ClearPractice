# ClearPractice roadmap: M7 to M16

> **Status:** proposed on 16 Oct 2026. Built so far: M7 foundations (16 Oct), M8 insights, M9 game core and M10 drills (17 Oct); progress is tracked in [DEVELOPMENT_PLAN.md](../../DEVELOPMENT_PLAN.md).
> **Decisions:** entries marked **Proposed** need your OK before the work that depends on them starts (§9).
> **Entry gate:** M6 (release hardening) is still open. Either finish its manual acceptance items first, or decide explicitly to start M7 alongside it. M7 changes no behaviour that M6 checks, except the lazy routes in 7.1.

This folder is the build specification for everything that comes after the first release. It covers four areas:

- **A game layer:** levels in eight areas of speaking, effort points, achievements, personal records, a weekly goal, quests and celebrations.
- **New drills:** Just a Minute, topic roulette, word bomb, the emphasis game, pace ladder, stories, a gauntlet and boss levels.
- **Learning science in the scheduler.**
- **Real-world features:** insights, a confidence pack, an AI conversation partner, events and talks, optional social features, and a mobile companion.

| File | Contents |
| --- | --- |
| [M07-foundations.md](M07-foundations.md) | **Foundations:** faster start-up, the practice-event ledger, the facts snapshot, drill support in sessions, Calm mode, the shared recorder panel and test helpers |
| [M08-insights.md](M08-insights.md) | **Insights and practice extras:** measures v2 (runs, pause location, words you use often, hedges, vocabulary, phrases spotted), opener and ending self-checks, waveform markers, A/B listening, trends, speech profile, live pace meter, sequence dots, Ctrl+K actions |
| [M09-game-core.md](M09-game-core.md) | **Game core:** Journey page, skill map with 8 areas × 5 levels, XP, achievements, personal records, weekly goal, quests, celebrations, companion, accent colours, monthly themes |
| [M10-drills.md](M10-drills.md) | **Drills:** the drill framework plus 12 drills |
| [M11-learning-engine.md](M11-learning-engine.md) | **Learning engine:** spaced re-answering, the challenge dial, interleaving, feedback timing, predict then check, the filler programme with "Catch it", saying phrases aloud, the weakest-area drill |
| [M12-confidence.md](M12-confidence.md) | **Confidence pack:** exposure ladder, pre-talk routine, after-action review, best-moments reel |
| [M13-conversation-partner.md](M13-conversation-partner.md) | **AI conversation partner:** voice roleplays, pressure dial, Q&A panel, upgrade loop |
| [M14-real-world.md](M14-real-world.md) | **Real world:** missions, event mode, talk builder, listener pack, voice time capsule |
| [M15-social.md](M15-social.md) | **Optional social features:** practice buddy, club mode, shared challenges, accountability note |
| [M16-platform.md](M16-platform.md) | **Platform:** mobile companion and LAN sync, surprise prompts, content packs, first-language tips, local models for small tasks, provider contract tests, docs, updates and signing |
| [appendix-a-skill-levels.md](appendix-a-skill-levels.md) | The 40 level definitions with exact criteria |
| [appendix-b-rewards.md](appendix-b-rewards.md) | XP table, achievements catalogue, personal records, quest templates |
| [appendix-c-content.md](appendix-c-content.md) | Drill parameters and every content list to write (topics, scenarios, missions…) |
| [appendix-d-copy.md](appendix-d-copy.md) | Copy deck and wording rules |
| [appendix-e-research.md](appendix-e-research.md) | Metrics glossary and research references |

---

## 0 How to use this plan

**Relation to the other documents**
- `ClearPractice-App-Blueprint.md` stays the product specification. Where this plan goes beyond it (levels, XP, AI conversation turns, a mobile app), a decision-log entry (D-29 onward) records the extension. The blueprint is not edited until those decisions are confirmed.
- `DEVELOPMENT_PLAN.md` stays the tracker. Each work package here has one checkbox there with the same number (for example **9.2**), and the usual rule applies: tick it only when verified.

**Template.** Every work package (WP) uses the same headings, and a heading is skipped when it would be empty:

> **Goal** · **User flow** · **Screens** · **Data** · **Native (Rust)** · **IPC** · **Front end** · **Rules** · **Tests** · **Done when** · **Effort**

**Numbering**
- Milestones continue the tracker, from M7 onward, and items are numbered `7.1`, `7.2`, and so on.
- Acceptance items continue from **A-26**, decisions from **D-29**, and SQLite schema versions from **v16**.

**Names.** Every name in `code` style is the name to use. If a name clashes with existing code, change it here first, then in the code, so the plan and the code never disagree.

**Effort** is in developer days for one developer working with an AI assistant, including tests:
- S is 0.5–1 day;
- M is 2–3 days;
- L is 4–6 days;
- XL is more than 6 days.

---

## 1 What we're building

The app already does the hard part: honest recording, transcription, measures with provenance, coaching with preview-and-send, and a scheduler with reasons. What it lacks is a reason to come back tomorrow and a bridge to real conversations. The roadmap adds three things:

1. **Play.** Make practice feel like a game, but one that rewards effort, challenge and real-world wins, and never grades your voice. Eight areas of speaking each have five levels, and you earn a level with practice evidence. Effort points (XP), achievements and personal records always compare you only with yourself. There is a weekly goal instead of a fragile daily streak, plus drills that are fun on their own (Just a Minute, topic roulette, word bomb…).
2. **Learn.** Build learning science into the engine:
   - spaced re-answering;
   - difficulty that keeps you succeeding about 85% of the time (the 85% is an internal target and is never displayed);
   - interleaving;
   - feedback you choose when to see;
   - predict, then check;
   - habit reversal for fillers;
   - saying phrases aloud;
   - better fluency measures (runs between pauses, where pauses fall).
3. **Live.** Carry practice into real life:
   - a confidence pack (exposure ladder, pre-talk routine, after-action review, best moments);
   - an AI conversation partner with voice;
   - event mode for real talks and interviews;
   - a listener pack that a friend can answer without any cloud service;
   - a mobile companion.

---

## 2 Principles (apply to every work package)

| # | Principle | What it means in code and copy |
| --- | --- | --- |
| P-1 | **Reward effort and evidence, never voice quality** | XP comes only from actions (a take saved, a reflection written). Levels need practice evidence (task conditions, reviewed takes, your notes, a listener's words). No value is turned into a score, grade or percentage (A-22, A-26). |
| P-2 | **Compare only with your past self** | Records and trends show your previous value and date. There are no leaderboards, no "average user", no CEFR. |
| P-3 | **No punishment** | No lives, hearts or energy. Missing days never "breaks" anything: the weekly goal resets on its own with fresh-start copy, and nothing earned is ever taken away (A-28). |
| P-4 | **You choose** | Every recommendation shows its reason and can be skipped or swapped. Recommended-after content is a soft lock ("Try anyway"), not a wall (blueprint §7, A-19). Calm mode turns the game layer off (A-27). |
| P-5 | **Local first, preview and Send** | The seven rules under "Data that leaves this computer" in `DEVELOPMENT_PLAN.md` apply unchanged. New senders (conversation turns, Q&A panels, upgrades) each get their own preview and a single-use approval (A-33). |
| P-6 | **Provenance on every value** | Every new number carries one of the labels Measured, Estimated, Your note or AI suggestion (`EvidenceLabel`). A missing value is `null` with a reason, never 0. |
| P-7 | **AI can't decide your level** | Levels, achievements and records come only from local facts and your own notes. An AI suggestion can be shown as evidence but never counts toward a criterion (A-29, blueprint §7 "LLM ratings alone cannot unlock or block a stage"). |
| P-8 | **Calm, not addictive** | Countdowns appear only inside drills you chose. There are no guilt notifications, no FOMO, nothing paid. Celebrations are brief, once per event, and respect reduced motion. |
| P-9 | **Never lose audio** | Timed drills, auto-stop, conversation turns and rehearsals all use the same recorder pipeline: saved on stop, guarded on leave, recoverable after a crash (A-31). |
| P-10 | **Accessible by default** | Keyboard first, screen-reader announcements only on state changes, 40 px controls, light and dark modes, axe-clean (A-37). |

---

## 3 Milestone map

| Milestone | Theme | Main deliverables | Needs | Effort | You'll notice |
| --- | --- | --- | --- | --- | --- |
| **M7** | Foundations | <ul><li>lazy routes and a bundle budget</li><li>`practice_events` ledger</li><li>`get_practice_facts`</li><li>activity snapshot on sessions</li><li>Calm mode switch</li><li>`RecorderPanel` extraction</li><li>test helpers</li><li>`commands/` module</li></ul> | M6 gate, or your OK | 8–11 d | Faster start-up, Settings → Practice style |
| **M8** | Insights and extras | <ul><li>measures v2</li><li>self-checks</li><li>phrases spotted</li><li>waveform markers</li><li>A/B listen</li><li>trends</li><li>speech profile</li><li>live pace meter</li><li>sequence dots</li><li>Ctrl+K actions</li></ul> | M7 | 12–16 d | Richer take summaries, Progress → Profile and Trends |
| **M9** | Game core | <ul><li>Journey</li><li>skill map</li><li>XP</li><li>achievements</li><li>records</li><li>weekly goal</li><li>quests</li><li>celebrations</li><li>companion</li><li>accents</li></ul> | M7, M8 (8.1) | 14–19 d | A new **Journey** page; Today strip; Practice complete shows what you earned |
| **M10** | Drills | <ul><li>drill framework</li><li>JAM</li><li>roulette</li><li>word bomb</li><li>three ways</li><li>emphasis</li><li>pace ladder</li><li>stories</li><li>pitch</li><li>steelman</li><li>daily prompt</li><li>gauntlet</li><li>boss levels</li></ul> | M7, M8 (8.8 for the pace ladder), M9 (for records and unlocks) | 16–22 d | Exercises → **Drills** tab |
| **M11** | Learning engine | <ul><li>re-answering</li><li>challenge dial</li><li>interleaving</li><li>feedback timing</li><li>predictions</li><li>filler programme</li><li>Catch it</li><li>phrase Say it</li><li>weakest-area drill</li></ul> | M8, M9, M10 | 10–14 d | Smarter Today; Journey → Programmes |
| **M12** | Confidence pack | <ul><li>exposure ladder</li><li>pre-talk routine</li><li>after-action review</li><li>best-moments reel</li></ul> | M7, M8 | 8–11 d | New **Confidence** page |
| **M13** | Conversation partner | <ul><li>roleplays with local voices</li><li>pressure dial</li><li>Q&A panel</li><li>upgrade loop</li><li>scripted offline mode</li></ul> | M7, M10 (boss levels v2) | 14–20 d | New **Partner** page |
| **M14** | Real world | <ul><li>missions</li><li>event mode</li><li>talk builder</li><li>listener pack</li><li>time capsule</li></ul> | M9, M12 | 12–17 d | New **Events** page; listener files |
| **M15** | Social (optional) | <ul><li>buddy exchange</li><li>club mode</li><li>shared challenges</li><li>accountability note</li></ul> | M10, M14 | 6–9 d | Club timer screen |
| **M16** | Platform | <ul><li>mobile companion (gated)</li><li>surprise prompts</li><li>content packs</li><li>first-language tips</li><li>local small models</li><li>contract tests</li><li>docs</li><li>updates and signing</li></ul> | M7–M14 | 25–45 d | Phone app, What's new |

Total: about 125–185 developer days for everything. **M7 to M10 (about 50–68 days) deliver the game experience you asked for**, and the rest can follow in any order the dependencies allow.

---

## 4 Order, dependencies and parallel work

```
M6 gate ─► M7 Foundations ─► M8 Insights ─► M9 Game core ─► M10 Drills ─► M11 Learning engine
                │                 │               │               └──────► M13 Partner (boss v2)
                │                 └──► M12 Confidence ◄──────────────┘
                └──────────────────────────────────────► M14 Real world (needs M9, M12) ─► M15 Social
M16 Platform: 16.5–16.8 any time after M7, 16.9 after the features it measures; 16.1 mobile only after its feasibility gate.
```

**Can run as parallel sessions.** Each piece below touches its own files. Each runs in its own worktree, with one writer per file set.

| After | These can run in parallel | Shared files to avoid touching twice |
| --- | --- | --- |
| M7 | 7.1 speed pass ‖ 7.2 content move ‖ 7.7 test helpers | `routes.tsx` (7.1 only), `mock-data.ts` (7.2 only) |
| M8 | 8.1–8.3 measures (Rust heavy) ‖ 8.4 A/B listen ‖ 8.9 sequence dots and 8.10 Ctrl+K | `analysis.rs` (8.1 only), `TakeSummary.tsx` (8.2 only) |
| M9 | 9.2 levels engine (pure TS) ‖ 9.12 accent colours ‖ 9.11 companion art | `schemas.ts` additions are merged in order |
| M10 | each drill after 10.1 (one drill per session) | `src/content/drills.ts` (append-only) |
| M12 / M13 / M14 | M12 ‖ M13 | `AppSidebar` / `nav.ts` changed once in each; merge in order |

**Recommended order:** M7 → M8 → M9 → M10 → M13 → M12 → M11 → M14 → M16 (the small items) → M15 → M16.1 (mobile). The partner (M13) comes before the confidence pack because it raises the ceiling the most. You can swap M12 and M13.

---

## 5 How you'll use it (journeys)

### 5.1 A normal Monday (Playful style)
1. **Open the app.** Today shows the date, the week row (now with a goal ring: "0 of 3 days"), and on the right the **Journey strip**:
   - this week's three quests;
   - the next level within reach ("Fluency 2 · 2 of 3 reviewed takes");
   - a **fresh-start note** on Mondays and on the 1st ("New week. Three quests are ready.").
2. **Practise.** Press **Start practice** and do the usual sequence. After each take, a quiet toast says "+10 XP" (once, never during recording). When the take is transcribed, the take summary shows the new measures (runs, where pauses fell, words you used often, phrases spotted) and, if one fell, a **New personal record** line.
3. **Finish.** **Practice complete** adds a "**Today you earned**" panel:
   - XP;
   - any level reached, with its evidence ("Fluency 2 · Replacing: 3 takes where you confirmed fewer hesitations than in your first five");
   - achievements;
   - weekly goal progress;
   - the companion growing a leaf.

   A reached level gets one short celebration card (ring fills, check pops; static under reduced motion).
4. **Look around.** **Journey** shows:
   - the skill map (8 cards with 5 dots each);
   - this week's quests (one swap allowed);
   - recent achievements;
   - records.

   Clicking an area opens its detail sheet: what each level means, what you have done toward the next one, links to the sessions that count, and "Practise this" buttons (drills recommended for that area).

### 5.2 Playing a drill
1. **Pick a drill.** Exercises → **Drills** → **Just a Minute** shows its card: the rules, about 2 minutes, your best "52 clean seconds", and areas Fluency and Spontaneity.
2. **Speak.** **Play** opens the drill studio:
   - a topic card appears;
   - a 5-second think countdown runs;
   - the recorder starts by itself;
   - a ring counts down 60 s;
   - the take stops and saves by itself at 0.
3. **See the result.** Local Whisper transcribes the take. The result shows:
   - about 47 clean seconds (*Estimated*);
   - hesitation candidates on the timeline;
   - long pauses;
   - repeats;
   - your previous best.

   Then choose **Again (new topic)** or **Same topic**.

### 5.3 Preparing for a job interview in 10 days
1. **Create the event.** Events → **New event** → "Interview at Acme", date, 45 minutes, Interview. The plan appears spread over the 10 days:
   - outline your stories (STAR);
   - two timed run-throughs;
   - a mock interview with the AI partner;
   - a dress rehearsal 2 days before;
   - the 3-minute pre-talk routine on the day;
   - a debrief afterwards.
2. **Daily reminders.** Today shows "Interview in 6 days · today: run-through 2" with a button.
3. **Mock interview.** Partner → **Job interview**, persona Skeptical, pressure 2. The partner speaks with a local Windows voice. You answer by recording, and your answer is transcribed locally. With cloud coaching, each partner turn shows a one-line Send bar ("Send your answer to OpenAI · at most $0.0008"). With a local model you can tick "Send turns to the local model without asking". At the end you get a summary and an optional upgrade loop on your weakest answer.
4. **On the day.** **Before a real talk** runs the routine: breathing, warm-ups, "I'm excited", a worry dump, and self-talk with your name.
5. **Afterwards.** The **after-action review** asks four questions: planned, happened, why, next time. It counts toward Real-world courage.

### 5.4 Working on nerves in meetings
1. **Build a ladder.** Confidence → **Exposure ladder** → choose a template ("Meetings") and edit the eight steps.
2. **Rate each step.** Before a step, rate discomfort from 0 to 10; afterwards, rate it again. The ladder chart shows your before and after over weeks. Both are *Your note*, never placed next to a voice measure.
3. **Count it.** Completing a step with a before-rating of 6 or more counts toward Real-world courage level 4.

### 5.5 Preferring calm
Settings → Practice → **Practice style: Calm**. Several things disappear:
- Journey, the Today strip and XP toasts;
- celebrations, quests and the companion;
- PB badges on drill results.

Drills, insights, the confidence pack and the partner stay. Everything keeps being recorded, so switching back to Playful shows the full history. Nothing is lost (A-27).

---

## 6 Architecture

### 6.1 Layers (unchanged shape)

```
React UI (src/features/*)  ── uses ──►  src/lib/engagement/* (pure rules, TS)
        │                                        ▲
        ▼                                        │ PracticeFacts (one snapshot)
src/lib/ipc (IpcClient + zod) ── invoke ──►  Rust commands (src-tauri/src/commands/*)
                                                 │
                                                 ▼
                                   storage::database::DatabaseOwner (+ storage/*.rs)
                                   analysis.rs · prosody.rs · audio/* · api/* · conversation.rs
```

**Rules engines in TypeScript, facts and ledgers in Rust**
- The level, achievement, record, quest and weekly-goal engines are pure TypeScript functions in `src/lib/engagement/`, like `scheduler.ts` today. They read one compact snapshot, `PracticeFacts`, returned by a single SQL-backed command, `get_practice_facts`. This is fast and avoids the N+1 IPC calls that `getProgress` does now.
- XP is awarded in Rust, inside the same transaction as the action that earned it, so it can't drift from the data.
- Unlocks (levels, achievements, records, quests) are evaluated in TypeScript and recorded through IPC. Rust checks their shape and records each one once.

### 6.2 New front-end folders

| Folder | Holds | First WP |
| --- | --- | --- |
| `src/lib/engagement/` | `types.ts`, `random.ts`, `weekly.ts`, `criteria.ts`, `skills.ts`, `evaluate.ts`, `xp.ts`, `achievements.ts`, `records.ts`, `quests.ts`, `unlocks.ts` | 7.6, 9.x |
| `src/features/engagement/` | `EngagementProvider.tsx`, `CelebrationHost.tsx`, `celebrations.ts`, `useEngagement.ts` | 9.10 |
| `src/features/journey/` | `JourneyPage.tsx`, `SkillMap.tsx`, `AreaSheet.tsx`, `WeekGoal.tsx`, `QuestList.tsx`, `RecordsList.tsx`, `AchievementsPage.tsx`, `JourneyStrip.tsx`, `Companion.tsx`, `EarnedToday.tsx` | 9.x |
| `src/features/insights/` | `SpeechProfile.tsx`, `Trends.tsx`, `AbListen.tsx`, `SelfChecks.tsx`, `LivePaceMeter.tsx` | 8.x |
| `src/features/drills/` | `DrillsTab.tsx`, `DrillCard.tsx`, `DrillStudio.tsx`, `drill-module.ts`, `useDrillClock.ts`, `CountdownRing.tsx`, plus one folder per drill (`jam/`, `roulette/`, `word-bomb/`, `three-ways/`, `emphasis/`, `pace-ladder/`, `story/`, `pitch/`, `steelman/`, `daily/`, `gauntlet/`, `boss/`) | 10.x |
| `src/features/learning/` | `ReanswerCard.tsx`, `ChallengeDial.tsx`, `PredictCard.tsx`, `ProgrammePage.tsx`, `CatchIt.tsx`, `PhraseSayIt.tsx` | 11.x |
| `src/features/confidence/` | `ConfidencePage.tsx`, `ExposureLadder.tsx`, `DiscomfortScale.tsx`, `RoutinePage.tsx`, `BreathingCircle.tsx`, `AfterActionForm.tsx`, `BestMoments.tsx` | 12.x |
| `src/features/partner/` | `PartnerHub.tsx`, `ConversationPage.tsx`, `TurnBubble.tsx`, `TurnSendBar.tsx`, `PressureDial.tsx`, `QaPanel.tsx`, `UpgradeLoop.tsx`, `voices.ts` | 13.x |
| `src/features/events/` | `EventsPage.tsx`, `EventPage.tsx`, `EventForm.tsx`, `TalkBuilder.tsx`, `CueCards.tsx`, `RehearsalReport.tsx`, `ListenerPackDialog.tsx`, `MissionCard.tsx`, `TimeCapsule.tsx` | 14.x |
| `src/content/` | new `exercises.ts`, `drills.ts`, `jam-topics.ts`, `roulette-topics.ts`, `word-bomb-words.ts`, `story.ts`, `emphasis-sentences.ts`, `daily-prompts.ts`, `bosses.ts`, `star-questions.ts`, `scenarios.ts`, `missions.ts`, `routine.ts`, `programmes.ts`, `exposure-templates.ts`, `monthly-themes.ts`, `talk-templates.ts`, `first-language-tips.ts`, `whats-new.ts` | 7.2, 10.x… |
| `src/lib/` (pure helpers) | `insights/` (`words.ts`, `trends.ts`, `profile.ts`), `learning/` (`reanswer.ts`, `feedback.ts`, `programmes.ts`, `catch-it.ts`, `sprint.ts`), `events/plan.ts`, `social/codes.ts`, `diff.ts` (13.10) | 8.x–15.x |

### 6.3 New Rust modules

| File | Holds | First WP |
| --- | --- | --- |
| `src-tauri/src/commands/mod.rs` + `commands/<area>.rs` | New `#[tauri::command]` functions, grouped by area, registered in `lib.rs` `generate_handler!` as `commands::engagement::get_practice_facts` and so on. Existing commands stay in `lib.rs`; `with_storage` and `SessionStorage` become `pub(crate)` | 7.8 |
| `src-tauri/src/exercise_types.rs` | `KNOWN` exercise types and `is_known` (validated in Rust; no SQL `CHECK` since v16, D-30) | 7.3 |
| `src-tauri/src/activity.rs` | `ActivityContext`, `ActivityStep` (7.3); `TakeEventKind` (10.1) | 7.3, 10.1 |
| `src-tauri/src/engagement.rs` | `RULES_VERSION`, `EventKind` (parse, `as_str`, `xp`), `NewEvent`, daily caps | 7.4 |
| `src-tauri/src/storage/engagement.rs` | `award()`, `list_practice_events`, `practice_facts`, backfill; later levels, achievements, records, quests | 7.4, 7.6, 9.x |
| `src-tauri/src/storage/insights.rs` | `phrase_uses`, `self_checks`, `audio_measures`, `comparisons` | 8.x |
| `src-tauri/src/audio/syllables.rs` | `detect`, `LiveCounter` (syllable nuclei) | 8.8 |
| `src-tauri/src/storage/drills.rs`, `src-tauri/src/activity_results.rs` | `take_events`, drill results (computed, cached in `activity_results`) | 10.1 |
| `src-tauri/src/prosody.rs` (extend) | `prominence()` for the emphasis game | 10.6 |
| `src-tauri/src/storage/learning.rs` | predictions, programmes, catch runs | 11.x |
| `src-tauri/src/storage/confidence.rs` | exposure, segment marks, routine runs | 12.x |
| `src-tauri/src/conversation.rs` + `storage/conversations.rs` | partner prompting, validation, turns | 13.x |
| `src-tauri/src/storage/events.rs`, `src-tauri/src/listener_pack.rs` | missions, events, talks, rehearsals, listener packs | 14.x |
| `src-tauri/src/storage/social.rs` | club meetings | 15.2 |
| `src-tauri/src/sync/` | pairing, LAN sync (only if the 16.1 gate passes) | 16.1 |

### 6.4 The engagement loop

```
action (take saved, reflection, review, …)
  └─ Rust: same transaction → INSERT OR IGNORE practice_events(kind, ref_id, xp)
UI: EngagementProvider.refresh(reason)   ← called after the action, debounced 400 ms, single-flight
  1. facts  = ipc.getPracticeFacts()
  2. stored = ipc.getEngagementState()          (levels, achievements, records, this week's quests)
  3. diff   = evaluate(facts, stored, DEFINITIONS) (pure TS)
  4. ipc.recordUnlocks(diff)                     (Rust validates, INSERT OR IGNORE, awards XP events)
  5. queryClient.invalidateQueries(["engagement"])
  6. CelebrationHost.enqueue(diff → celebrations)  (skipped in Calm; deferred while recording)
```

The provider also runs once at app start, so anything earned while it wasn't running (an older version, or a restore) is caught up silently with no celebration. The celebration window covers only items unlocked in this session.

### 6.5 IPC conventions (as today)
- Methods are camelCase on `IpcClient` and mirror snake_case Rust commands.
- Every result is parsed with a zod schema in `schemas.ts`.
- The mock client implements every method in memory with sample data, so `npm run dev` stays usable. The rule "mock parity before UI" still holds.
- Query keys live in `keys` in `queries.ts`; engagement keys start with `"engagement"` so one invalidation refreshes them all.
- Events (`listen`) use snake_case names, `live_pace` for example, and are parsed in `native-client.ts`.

### 6.6 Preferences added (Rust `Preferences` + zod `Preferences` + `DEFAULT_PREFERENCES` + `validate`)

| Field | Type, default | WP |
| --- | --- | --- |
| `practiceStyle` | `"playful" \| "calm"`, `"playful"` (D-32) | 7.5 |
| `styleChosen` | boolean, false (the one-time choice card) | 7.5 |
| `celebrations` | `"full" \| "subtle" \| "off"`, `"full"` | 7.5 |
| `celebrationSounds` | boolean, false | 7.5 |
| `livePace` | boolean, false | 8.8 |
| `watchWords` | string[] (max 20, each ≤ 30 chars), [] | 8.1 |
| `weeklyGoalDays` | 1–7, 3 | 9.8 |
| `weekStartsOn` | `"monday" \| "sunday"`, `"monday"` | 9.8 |
| `companion` | boolean, true | 9.11 |
| `accent` | `"green" \| "ocean" \| "amber" \| "violet" \| "rose" \| "graphite"`, `"green"` | 9.12 |
| `displayName` | string ≤ 40, `""` | 12.2 |
| `warmUp` | boolean, false | 11.3 |
| `feedbackTiming` | `"always" \| "on_request" \| "faded"`, `"always"` | 11.4 |
| `predictFirst` | boolean, false | 11.5 |
| `challengeBias` | -1, 0 or 1; default 0 | 11.2 |
| `partnerVoice` | string or null, null (system default offline voice) | 13.7 |
| `partnerRate` | 0.8–1.2, 1.0 | 13.7 |
| `partnerAutoSendLocal` | boolean, false (D-33) | 13.1 |
| `partnerMaxCostMicroUsd` | 10 000–500 000, 50 000 | 13.1 |
| `surprisePrompts` | `{ enabled, from, to, days[] }`, disabled | 16.2 |
| `firstLanguage` | string or null, null | 16.4 |
| `lastSeenVersion` | string or null, null | 16.7 |

Each field needs:
- a default in Rust `Default`;
- a check in `validate`;
- a `preferences.rs` round-trip test;
- the zod field;
- the `DEFAULT_PREFERENCES` entry;
- the mock default.

`Preferences` is `.strict()`, so a field missing on one side fails the contract test, which is intended.

---

## 7 Data model

### 7.1 Schema versions (one per milestone, assigned in merge order)

| Version | WP | Adds |
| --- | --- | --- |
| v16 | 7.3, 7.4 | `exercise_definitions` rebuilt without its type `CHECK` (D-30); `sessions.activity_snapshot TEXT`; `practice_events` |
| v17 | 8.x | `phrase_uses`, `self_checks`, `audio_measures`, `comparisons` |
| v18 | 9.x | `skill_levels`, `achievements`, `personal_records`, `weekly_quests`; `transfer_reviews.flow`, `transfer_reviews.tags` |
| v19 | 10.1 | `take_events`, `activity_results` |
| v20 | 11.x | `self_predictions`, `programmes`, `programme_steps`, `catch_runs` |
| v21 | 12.x | `exposure_steps`, `exposure_attempts`, `segment_marks`, `routine_runs`; `transfer_reviews.kind`, `transfer_reviews.extra` |
| v22 | 13.x | `conversations`, `conversation_turns` |
| v23 | 14.x | `mission_picks`, `transfer_reviews.mission_id`, `events`, `event_plan_items`, `talks`, `talk_sections`, `rehearsals`, `listener_packs`, `listener_feedback` |
| v24 | 15.2 | `club_meetings`, `club_speeches` |
| v25 | 16.1, 16.3 | `sync_devices`, `sync_log` (only if the mobile gate passes); `content_packs` |

If milestones merge in a different order, the version numbers follow the merge order. Update this table when that happens.

### 7.2 Rules for new tables
1. **Every table is `STRICT`**, with `TEXT` IDs from `crypto.randomUUID()` / `uuid` and `*_at_ms INTEGER` times. Local dates use the existing `GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'` check.
2. **No `CHECK(kind IN (…))` on lists that will grow** (event kinds, achievement IDs, drill kinds). Rust validates them with an enum instead. v16 removes the one such `CHECK` inherited from v1, on `exercise_definitions.type`, with a one-time table rebuild (D-30, 7.3).
3. **Engagement tables store IDs and numbers only:** never transcript text, never audio, never file paths (A-30). `evidence` and `data` JSON columns hold IDs, counts and units.
4. **Every table tied to a take** (`attempt_id`) is deleted in `purge_take_rows` (`database.rs`), and every table tied to a session is deleted in `delete_permanently`. This is tested by extending `delete_permanently_removes_every_derived_row`, or adding it if missing.
5. **Ledgers are kept:** `practice_events`, `skill_levels`, `achievements`, `personal_records` and `weekly_quests` keep their rows when the session or take they mention is purged. Their IDs simply stop resolving, and the UI shows "from a deleted session" (A-28).
6. **Backups** (`snapshot_to`) copy the whole database, so new tables are included automatically.
   - **Session export** (`backup/export.rs` `export_session`) adds the session's activity snapshot, take events, self-checks, conversation turns and listener feedback.
   - It does not add ledgers.
   - Restore swaps the whole database, as now.

### 7.3 Migration recipe (each version)
1. Add `src-tauri/src/storage/schema-vNN.sql`, ending in `PRAGMA user_version=NN;`. It is commented like the existing files: why each table exists and which WP it belongs to.
2. In `database.rs` (a script that rebuilds a table, like v16, runs through `migrate_rebuild`: foreign keys off, `foreign_key_check` before commit; 7.3):
   - set `const VERSION: i64 = NN`;
   - turn the last unconditional `migrate(..v(NN-1)..)` into `if version < NN-1 { … }`;
   - add `migrate(&mut connection, include_str!("schema-vNN.sql"))?;`.
3. Run any one-time backfill after the migrations, guarded by an `app_settings` key such as `engagement_backfill_v1` so it runs exactly once, like `backfill_measures`.
4. Tests:
   - `opens_a_vNN_minus_1_database_and_adds_vNN_tables` keeps rows and adds the new tables.
   - The existing downgrade fixture in the `database.rs` tests (the long `DROP …; PRAGMA user_version=1` script around line 2166) drops the new tables too, so the full upgrade chain test still starts from v1.
   - `refuses_a_newer_database` still passes with the new number.
5. Update `SCHEMA_VERSION` users: the backup manifest and restore refusal tests.

### 7.4 What happens on Trash, permanent deletion, restore and export

| Data | Move to Trash | Delete permanently | Restore a backup | Session export |
| --- | --- | --- | --- | --- |
| Take-level rows (`take_events`, `activity_results`, `self_checks`, `phrase_uses`, `audio_measures`, `comparisons`, `self_predictions`, `catch_runs`, `rehearsals`, `listener_packs` + `listener_feedback`, `segment_marks` via revision) | hidden with the take | deleted | as in backup | included |
| Session-level (`activity_snapshot`, `conversations` + turns; learner turns lose their take link when only the take is purged) | hidden | deleted | as in backup | included |
| Ledgers (`practice_events`, `skill_levels`, `achievements`, `personal_records`, `weekly_quests`) | kept | kept (dangling IDs) | as in backup | not included |
| User content not tied to sessions (exposure steps/attempts, routine runs, programmes, events + plan items, talks + sections, mission picks, club meetings) | own delete (soft, `deleted_at_ms`) | n/a | as in backup | not included (full backup only) |

---

## 8 Cross-cutting requirements

### 8.1 Privacy and data leaving the computer
- The seven shared rules in `DEVELOPMENT_PLAN.md` apply word for word. New outbound paths and their rules:
  - **conversation partner turns, Q&A panel, upgrade loop:** text only, each previewed, single-use approval, shared budget (13.x, D-33);
  - **listener pack:** a file you save and send yourself, and nothing is uploaded (14.4);
  - **share text** for the daily prompt and challenge codes: copied to the clipboard, with no audio and no transcript (10.11, 15.3);
  - **update check:** opt-in only (16.8, D-38).
- New offline features get a `net_guard` test proving they build no HTTP client (A-32): live pace, syllable rate, emphasis, best moments, listener pack export and import, and club mode.

### 8.2 No scores (A-22 extended to A-26)
- **Forbidden next to any speech value:** score, grade, rating of the voice, percentage, "out of 10/100", "x/10", mood or emotion words.
- **Allowed**, as in A-22:
  - counts ("3 of 4 words woven in");
  - your own ratings, labelled Your note (ease 1–5, discomfort 0–10);
  - XP;
  - level names.
- A-26 renders Journey, the area sheet, achievements, the Today strip, Earned today, drill results, Speech profile and Trends with realistic fixtures, and runs the `offending()` check from `a22-no-scores.test.tsx` (moved into `src/test/no-scores.ts` so both tests share it).
- **Wording to avoid in celebrations:** person praise ("You're a natural", "Perfect", "Fluent!"). Celebrate the task: "Three takes where pauses took the place of most hesitations". See appendix D.

### 8.3 Provenance for the new values

| Value | Label |
| --- | --- |
| Runs, pause location, words you use often, hedges, vocabulary range, phrases spotted | Estimated |
| Syllable rate, live pace, emphasis beat | Estimated |
| Clean seconds (JAM), words woven in (word bomb), icons used (story cubes) | Estimated |
| Self-checks, predictions, discomfort, ease, flow, AAR answers | Your note |
| Listener answers (reflection, listener pack) | Your note (listener's words), kept apart from your reading, as now |
| Partner replies, upgrades, Q&A questions | AI suggestion |
| Take duration, number of takes, practice days | Measured |

### 8.4 Accessibility
- Every new route passes axe in light and dark mode. Promote the scratchpad route audit to `scripts/a11y/axe_routes.py` (7.7) with a `ROUTES` list that each WP extends.
- Timers (drills, routine) announce through `aria-live="polite"` only at phase changes and at 30, 10 and 5 seconds left, never every second.
- Rings and charts have text equivalents: a `<p className="sr-only">` summary, or a visible label.
- Celebrations go to an `aria-live` status, never steal focus, and close with Esc.
- Every keyboard shortcut is listed in `ShortcutsDialog`. New ones (drills: Space to start, F to flag; A/B listen: A, B; Catch it: F) only work while their screen is open and never inside text fields (`typingTarget`).

### 8.5 Motion and celebrations
- Use CSS animations only (`animate-pop` exists; add `animate-ring-fill`, `animate-rise`), at most 600 ms, no confetti particles, no looping.
- Under `prefers-reduced-motion: reduce`, or `celebrations = "subtle"`, show a static card or a toast.
- With `celebrations = "off"`, show nothing (items still appear in Journey).
- At most one celebration on screen. The queue shows them one after another, with 1.2 s gaps, max three per refresh; the rest are summarised: "And 2 more in Journey".
- Never show one while recording, a countdown or a drill clock is running. The host defers until the recorder is idle.

### 8.6 Tokens (add to `src/index.css`, light and dark, mapped like the existing `--cp-*`)
- `--cp-level-1` … `--cp-level-5`: dot fills for levels. One hue ramp derived from `--cp-accent`, with every text pair ≥ 4.5:1.
- `--cp-xp`: XP accent (uses `--cp-accent` by default).
- `--cp-light-green`, `--cp-light-amber`, `--cp-light-red`: Toastmasters timing lights, always paired with a text label.
- `--cp-ring-track`: background of progress rings.
- `--cp-marker-pause`, `--cp-marker-filler`, `--cp-marker-liked`: waveform markers (8.4).
- `--cp-diff-added`, `--cp-diff-removed`: the upgrade loop's word diff (13.10), always with underline or strike-through too, never colour alone.
- Accent sets: `[data-accent="ocean"]` and so on, each overriding `--cp-accent`, `--cp-accent-foreground` and the level ramp in both themes (9.12).

### 8.7 Copy style
- Plain English, second person, en-GB spelling (D-9).
- Short sentences, verbs on buttons.
- No exclamation marks except in a single celebration headline.
- See appendix D for the deck and the banned-word list.

### 8.8 Performance budgets (release build, this laptop)

| What | Budget | Checked by |
| --- | --- | --- |
| Start-up to interactive Today | ≤ current median, and never more than +10% (record the baseline in 7.1) | `recordTiming("startup")`, A-36 |
| Initial JS (entry chunk, gzip) | ≤ 250 kB, or the 7.1 baseline − 30%, whichever is larger | `scripts/bundle-budget.mjs` |
| `get_practice_facts` with 2 years of history (1,500 sessions, 4,000 takes) | ≤ 80 ms | ignored Rust bench test + A-36 |
| `evaluate()` on the same facts | ≤ 30 ms | Vitest bench-style test with a generous bound (≤ 200 ms in CI) |
| Journey first render | ≤ 300 ms after navigation | manual, release build |
| Live pace CPU while recording | ≤ 3% of one core | manual (Task Manager) + note |

### 8.9 Offline behaviour
- Everything except the cloud partner, cloud coaching and the update check works offline.
- When local Whisper is missing:
  - drills fall back to audio-only results (pauses from VAD) and say what is missing;
  - the partner offers typed answers and the scripted partner.

### 8.10 Calm mode matrix

| Element | Playful | Calm |
| --- | --- | --- |
| Journey in the sidebar, Today strip | shown | hidden (the route still opens from Settings → Practice → "Open Journey") |
| XP toasts, celebrations, companion | shown | none |
| Achievements, records, levels | shown and celebrated | recorded silently; not shown outside Journey |
| Weekly goal ring | WeekRow shows the ring | WeekRow shows the dots only (today's behaviour) |
| Quests | shown | hidden, not generated |
| Drill results | with "best so far" | without "best so far" |
| Accent colours | all unlocked ones | all unlocked ones (appearance is not game) |
| Data recorded | everything | everything |

---

## 9 Decisions needed

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| D-29 | **Game layer within the blueprint.** Levels in 8 areas, XP for effort, achievements and records, all from practice evidence and your notes. No proficiency scores, no CEFR, AI can't award levels. Calm mode turns it off. | Yes. This keeps §1 "avoid a single numerical fluency score" and §7 "observable training criteria" intact. **Chosen 17 Oct** | M9, M10 |
| D-30 | **New exercise types for new formats.** Drills, Say it, conversation, upgrade, rehearsal and capsule each get an exercise type of their own, added when their feature lands. v16 rebuilds `exercise_definitions` once without its v1 type `CHECK` (foreign keys off, checked before commit); types are validated in Rust and zod from then on. A run's settings live in `sessions.activity_snapshot`, per-take steps in `task_conditions.challenge`. | **Chosen 16 Oct** (you chose new types over variants of the four) | 7.3, M10–M14 |
| D-31 | **Evaluation in TypeScript over a Rust facts snapshot.** XP is awarded in Rust transactions; unlocks are recorded natively and never removed by Trash. | **Chosen 16 Oct** | 7.4, 7.6, M9 |
| D-32 | **Default style** | Playful for everyone, with a one-time choice card ("Playful or Calm?") on the first Today visit after the update. Celebrations are full unless reduced motion is on. **Chosen 16 Oct** | 7.5 |
| D-33 | **Conversation partner approvals.** Each cloud turn keeps its own Send (single-use approval, rule 2). Local-model turns may be sent automatically during one conversation when you opt in, because nothing leaves the computer. Each conversation also has a cost cap. | Yes. The alternative, one approval for a whole conversation, would change data rule 2. **Chosen 17 Oct** | M13 |
| D-34 | **Live pace and syllable rate from syllable nuclei** (after de Jong and Wempe 2009, pure Rust, Estimated), opt-in, used for range drills, never a target speed (§7 "Do not demand faster speech"). | Yes. **Chosen 17 Oct** | 8.8, 10.7 |
| D-35 | **The listener pack is a file exchange.** No hosted links, no accounts. | Yes. **Chosen 17 Oct** | 14.4 |
| D-36 | **Mobile companion** | Feasibility gate first: Tauri 2 Android build, recording, LAN pairing and sync of one take. Only if it passes, build it (16.1). **Chosen 17 Oct** | 16.1 |
| D-37 | **Surprise prompts and system notifications** | In-app only by default; Windows notifications via `tauri-plugin-notification` (pinned) only as an explicit opt-in. **Chosen 17 Oct** | 16.2 |
| D-38 | **Updates and signing** | Code-sign the installer when you have a certificate. An update check (contacts GitHub) is opt-in, with "Check now" in Settings → About, and never automatic downloads (rule 1). **Chosen 17 Oct** | 16.8 |

D-30, D-31 and D-32 were decided on 16 Oct; D-29 and D-33 to D-38 on 17 Oct, all as recommended. Every decision is in the decision log in `DEVELOPMENT_PLAN.md`.

---

## 10 Testing strategy

### 10.1 Layers

| Layer | Tool | Where | What it proves |
| --- | --- | --- | --- |
| Pure rules | Vitest | `src/lib/engagement/*.test.ts`, `src/content/*.test.ts` | criteria, XP sums, weeks, quests, records: golden fixtures, edge cases (empty history, missing values, time zones, week starts) |
| Components | Vitest + Testing Library | next to each component | states (loading, empty, error, calm, reduced motion), keyboard, announcements, IPC calls with `vi.fn` spies |
| Contract | Vitest | `src/lib/ipc/*.test.ts` | mock and native clients parse the same schemas; preferences round-trip; every new `IpcClient` method exists in both |
| Rust units | `cargo test --lib` | `#[cfg(test)]` in each module | SQL, awards (idempotent, capped), purges, migrations, algorithms (syllables, prominence, phrase matching, runs) |
| Rust acceptance | `cargo test --lib acceptance` | `src-tauri/src/acceptance.rs` | A-28, A-30, A-32, A-33 (stand-in local servers only), A-34, A-38 |
| UI acceptance | Vitest | `src/acceptance/a26-…` onwards | A-26, A-27, A-29, A-31, A-35, A-37 (static parts) |
| Accessibility | Python Playwright + axe | `scripts/a11y/axe_routes.py` (7.7) | 0 violations on every route, light and dark |
| Benchmarks | ignored Rust tests, `scripts/bundle-budget.mjs` | as named | performance budgets (§8.8) |
| Manual desktop | recipes in `DEVELOPMENT_PLAN.md` | packaged build | microphone, voices, local model, real network off, reduced motion |

### 10.2 Test helpers (built in 7.7, used everywhere after)
- `src/test/render.tsx`: `renderWithApp(ui, { client?, path?, routes? })` wraps the `MemoryRouter`, `QueryClientProvider` (retry off) and `IpcContext` boilerplate repeated in today's tests, and adds a `Toaster`.
- `src/test/fixtures/facts.ts`: `factsBuilder()`, with `.session()`, `.take()`, `.transfer()`, `.phraseReview()`, `.days(n)` and `.build()`, which returns valid `PracticeFacts` (parsed with zod).
- `src/test/no-scores.ts`: the `offending()` check shared by A-22 and A-26.
- `src/test/clock.ts`: `withFakeToday("2026-10-12")`, which uses `vi.useFakeTimers()` and `vi.setSystemTime()` for week and date logic.
- Rust: `storage::engagement::tests::seed_history(db, days, takes_per_day)`, which builds realistic history quickly for facts and performance tests.

### 10.3 Naming
- Vitest names say the behaviour, like the existing ones: `it("awards Fluency 2 only after three reviewed takes below your baseline")`.
- Rust names are snake_case sentences: `award_is_idempotent_and_respects_the_daily_phrase_cap`.

### 10.4 How much to run (laptop rule)
- **While iterating:** the targeted files only (`npm.cmd test -- src/lib/engagement`, `cargo test --lib engagement`).
- **At the end of each WP:** `npm run typecheck` plus the WP's tests.
- **At each milestone gate:**
  - the full Vitest suite (`npm.cmd test -- --pool=threads --maxWorkers=1 --isolate=false`);
  - `cargo test --lib`;
  - the axe script;
  - `npm run build` with the bundle budget;
  - the manual recipes for that milestone.

### 10.5 New acceptance items

| # | Item | Automated by | Manual part |
| --- | --- | --- | --- |
| A-26 | The game layer shows no score, grade, percentage or mood next to any speech value | `src/acceptance/a26-game-no-scores.test.tsx` | — |
| A-27 | Calm mode hides every game element and loses no data; switching back restores it | `a27-calm-mode.test.tsx` | glance at the packaged build |
| A-28 | Earned effort is never taken away by Trash, permanent deletion or definition changes | `acceptance::a28_ledgers_survive_purges` (Rust) | — |
| A-29 | Only local facts and your own notes award levels, achievements and records; AI output never does | `a29-ai-cannot-award.test.ts` | — |
| A-30 | Engagement, drill and insight tables hold no transcript text, audio or paths | `acceptance::a30_engagement_tables_hold_ids_and_numbers` | — |
| A-31 | Timed drills never lose audio: auto-stop saves, leaving is guarded, a crash recovers | `a31-drill-audio-safety.test.tsx` + Rust capture test | kill the app mid-drill on the packaged build |
| A-32 | Live pace, syllable rate, emphasis, best moments, listener pack and club mode are offline | `net_guard` additions | — |
| A-33 | The partner sends nothing to a cloud provider without that turn's Send. A changed transcript needs a fresh preview, and local auto-send goes only to loopback when opted in. | Rust (stand-in local server) + `a33-partner-approvals.test.tsx` | one paid turn, with your OK |
| A-34 | The listener pack exports only the chosen take and questions; import validates and never runs content | Rust `listener_pack` tests | open `listen.html` offline in Edge |
| A-35 | Self-reports are labelled Your note and never shown as a judgement of an audio measure | `a35-self-reports.test.tsx` | — |
| A-36 | Performance with two years of seeded history meets §8.8 | ignored Rust bench + Vitest bound | release-build timings |
| A-37 | New routes are axe-clean in light and dark; celebrations respect reduced motion; timers announce sparingly | axe script + `a37-motion.test.tsx` | Narrator pass on Journey and one drill |
| A-38 | Backups, restore and session export carry the new data | Rust backup tests | — |
| A-39 | Mobile sync stays on the local network and needs pairing on both devices | Rust sync tests | two-device check |

### 10.6 Manual recipes
Each milestone adds its recipes under "Acceptance suite" in `DEVELOPMENT_PLAN.md`, in the existing style: numbered steps, each with "Observe:". They cover what tests can't:
- real microphones;
- Windows voices;
- reduced motion in Windows settings;
- Narrator;
- the packaged build;
- the network switched off.

---

## 11 Definition of done

**A work package is done when all of these hold:**
- The code follows the names in this plan, or the plan was updated first.
- The mock client implements every new method, and `npm run dev` shows the feature with sample data.
- Its tests (as listed in the WP) pass, and typecheck is clean.
- New values carry provenance labels, and missing values have reasons.
- Light and dark mode look right. Controls are 40 px (36 px compact). No browser-default widgets remain (use `Select`, `Checkbox`, `Slider`, `Switch`).
- A-22 and A-26 still pass if the WP adds any visible value.
- Dependencies are pinned exactly (no `^`).
- `DEVELOPMENT_PLAN.md` has the WP checkbox ticked (only once verified) and notes on anything not checked on the desktop yet.

**A milestone is done when:**
- every WP in it is done;
- the full Vitest suite and `cargo test --lib` pass;
- the axe script shows 0 violations;
- the bundle budget holds;
- its acceptance items pass;
- its manual recipes pass on a packaged build;
- the "Current status" table is updated.

---

## 12 Risks

| Risk | Mitigation |
| --- | --- |
| The game layer feels manipulative or turns into grinding | P-1 to P-8; caps in the XP table (appendix B); Calm mode; weekly goal instead of daily streaks; review copy with appendix D |
| Levels feel unfair because a measure is wrong (ASR missed fillers) | Fluency criteria use reviewed takes only; every level has an alternative path; levels are never removed |
| Whisper isn't set up, so many criteria can't progress | Level 1 of every area has an audio-only or self-report path; the facts carry `transcriptionAvailable`; the area sheet explains the gap with a one-click setup link |
| Schema churn over 10 versions | One version per milestone; the migration recipe; the full-chain test from v1 |
| Partner latency and cost | Local model option; per-turn cost in the preview; per-conversation cap; scripted offline partner |
| Local Windows voices sound robotic | Voice picker with preview; captions always shown; the partner works muted |
| `lib.rs` keeps growing | New commands go in `src-tauri/src/commands/` (7.8) |
| Weak laptop: tests are slow | Targeted tests while iterating; full suites at gates (§10.4) |
| Mobile scope explodes | Feasibility gate (D-36) before any commitment |

---

## 13 Glossary

**Area**
: One of the eight skill areas (Structure & clarity, Fluency, Voice & delivery, Spontaneity, Vocabulary & phrasing, Listening & imitation, Storytelling, Real-world courage).

**Level**
: One of five steps in an area, earned by evidence (appendix A). It is different from the scheduler's **stage** (1–5 task demand, `scheduler.ts`), which stays as it is.

**XP**
: Effort points, awarded for actions (appendix B). XP has no overall level.

**Fact**
: A row in the `PracticeFacts` snapshot: sessions, takes and their measures, reflections, reviews and so on.

**Ledger**
: An append-only table that keeps what you earned: `practice_events`, `skill_levels`, `achievements`, `personal_records`, `weekly_quests`.

**Drill**
: A game-like variant of an exercise with its own rules, timer and result (M10).

**Soft lock**
: "Recommended after Fluency 2 · Try anyway". It is never a hard block.

**Clean seconds**
: In Just a Minute, speech time without hesitation candidates, long pauses or immediate repeats (Estimated).

**Run**
: Words spoken between pauses of 0.7 s or more, using segment timings (Estimated). The mean run is the mean length of run (MLR).
