# Appendix B: Rewards (XP, achievements, personal records, quests)

**Sources of truth**
- XP values live in Rust: `engagement::EventKind::xp()` and `daily_cap()`.
- Achievements, records and quests live in TypeScript:
  - `src/lib/engagement/achievements.ts`
  - `records.ts`
  - `quests.ts`
- Keep this appendix and the code in step. Each list has a sanity test.

---

## B.1 XP table (`RULES_VERSION = 1`)

**XP rewards effort, never quality.**
- Caps stop grinding: an event above a cap is still recorded, but gives 0 XP.
- Every action earns once (`UNIQUE(kind, ref_id)`).

| Event kind | XP | Rule / cap | From |
| --- | --- | --- | --- |
| `take_saved` | 10 | take ≥ 10 s and ordinal ≤ 6 in its session | 7.4 |
| `retake` | 5 | ordinal 2–6 and ≥ 10 s (on top of `take_saved`) | 7.4 |
| `sequence_completed` | 20 | Practice complete with at least one take | 7.4 |
| `reflection_saved` | 10 | ease or takeaway saved, once per session | 7.4 |
| `transcript_reviewed` | 10 | every hesitation candidate of the current revision decided | 7.4 |
| `phrase_saved` | 5 | not starter cards · max 5 a day | 7.4 |
| `phrase_reviewed` | 2 | max 10 a day | 7.4 |
| `transfer_review` | 30 | a real-conversation reflection | 7.4 |
| `baseline_saved` | 20 | once | 7.4 |
| `level_reached` | 50 | per area level | 9.3 |
| `achievement` | 20 | per achievement | 9.3 |
| `personal_record` | 25 | improvements only (not the first value) | 9.3 |
| `weekly_goal` | 50 | per week | 9.3 |
| `quest` | 30 | per quest | 9.3 |
| `drill_round` | 15 | first take of each drill session | 10.1 |
| `reanswer_skipped` | 0 | bookkeeping only | 11.1 |
| `prediction` | 5 | max 5 a day | 11.5 |
| `catch_run` | 10 | — | 11.6 |
| `programme_step` | 10 | — | 11.6 |
| `exposure_step` | 30 | an attempt marked done | 12.2 |
| `routine` | 10 | — | 12.3 |
| `after_action` | 20 | on top of `transfer_review` | 12.4 |
| `upgrade` | 20 | retell take saved | 13.10 |
| `conversation` | 30 | ≥ 3 learner turns | 13.11 |
| `mission` | 40 | — | 14.1 |
| `event_debrief` | 40 | — | 14.2 |
| `listener_answers` | 30 | per imported answer file | 14.4 |
| `capsule` | 20 | — | 14.5 |

**Typical totals**

| What you do | XP |
| --- | --- |
| A standard 13-minute session (4 takes, completion, reflection) | about 80 |
| … plus reviewing one take | about 90 |
| A 3-day week, plus the goal and three quests | about 400 |

These figures go in "How XP works" (9.5) so the numbers feel predictable.

---

## B.2 Achievements (`ACHIEVEMENTS_VERSION = 1`)

**Display rules**
- Everything is visible, with no hidden achievements.
- Unlocked achievements show their date.
- Locked ones show progress ("2 of 3").

The table lists each achievement's ID, title, description (shown to the user), the criterion behind it, what it unlocks, and the milestone that introduces it.

### Getting started (`start`)

| ID | Title | Description | Criterion | Unlocks | From |
| --- | --- | --- | --- | --- | --- |
| `first-take` | First take | Save your first take. | `takes` ≥ 1 | — | M9 |
| `first-session` | First session | Finish a practice sequence. | event `sequence_completed` ≥ 1 | — | M9 |
| `baseline` | Starting point | Record your baseline answer. | event `baseline_saved` | — | M9 |
| `first-transcript` | In writing | Transcribe a take. | `takes` transcribed ≥ 1 | — | M9 |
| `first-review` | Noticed | Review the hesitation candidates in a take. | `takes` `fillersReviewed` ≥ 1 | — | M9 |
| `first-phrase` | Keeper | Save your first phrase. | `phrases` saved ≥ 1 | — | M9 |
| `first-reflection` | Out in the world | Note a real conversation. | `transfers` ≥ 1 | accent **rose** | M9 |

### Habit (`habit`)

| ID | Title | Description | Criterion | Unlocks | From |
| --- | --- | --- | --- | --- | --- |
| `goal-1` | Week one | Reach your weekly goal. | goal weeks ≥ 1 | accent **ocean** | M9 |
| `goal-4` | Four in a row | Reach your weekly goal four weeks in a row. | weeks in a row ≥ 4 | pot **blue glaze** | M9 |
| `goal-12` | A season of practice | Twelve weeks in a row. | weeks in a row ≥ 12 | pot **stone** | M9 |
| `days-10` | Ten days | Practise on 10 days. | practice days ≥ 10 | accent **amber** | M9 |
| `days-30` | Thirty days | Practise on 30 days. | practice days ≥ 30 | accent **graphite** | M9 |
| `days-100` | A hundred days | Practise on 100 days. | practice days ≥ 100 | pot **wood** | M9 |
| `comeback` | Welcome back | Practise again after 14 days or more away. | a practice day following a gap of ≥ 14 days | — | M9 |
| `fresh-start` | Fresh start | Practise on the first day of a month. | a practice day on the 1st | — | M9 |

### Craft (`craft`)

| ID | Title | Description | Criterion | From |
| --- | --- | --- | --- | --- |
| `three-takes` | Third time | Record three takes in one session. | a session with ≥ 3 takes | M9 |
| `no-notes` | Said it without notes | Speak for a minute or more with an empty outline. | `takes` 60 s+ in a session with no outline field filled | M9 |
| `long-run-15` | Long run | Say 15 words or more between pauses. | `longestRun` ≥ 15 (Estimated) | M9 (needs 8.1) |
| `steady-minute` | Steady minute | A minute or more with at most one pause inside a clause. | Fluency L3 take criterion, once | M9 (needs 8.1) |
| `point-first-5` | Straight to the point | Note "point first" on 5 takes. | check `point_first` ≥ 5 | M9 (needs 8.3) |
| `clear-ending-5` | Strong finish | Note a clear ending on 5 takes. | check `clear_ending` ≥ 5 | M9 (needs 8.3) |
| `profile-ready` | Know your voice | Have enough takes for every row of your speech profile. | every `buildProfile` row available | M9 (needs 8.7) |
| `prediction-10` | Self-aware | Make 10 predictions before looking. | predictions ≥ 10 | M11 |

### Courage (`courage`)

| ID | Title | Description | Criterion | From |
| --- | --- | --- | --- | --- |
| `unfamiliar-first` | Into the unknown | Answer an unfamiliar question. | `sessions` unfamiliar ≥ 1 | M9 |
| `no-prep-3` | No notice | Answer 3 unfamiliar questions with 10 seconds or less to prepare. | `sessions` unfamiliar, prep ≤ 10, ≥ 3 | M9 |
| `follow-up-3` | And then? | Answer follow-up questions in 3 sessions. | `sessions` followUp, `minTakes: 2`, ≥ 3 | M9 |
| `gauntlet-done` | Ran the gauntlet | Complete a gauntlet. | `activity` gauntlet with 5 rounds | M10 |
| `boss-interview` | Interview ready | Finish the job interview boss. | `activity` boss `job-interview` | M10 |
| `boss-qa` | Held the floor | Finish the sceptical Q&A boss. | boss `skeptical-qa` | M10 |
| `boss-toast` | Raise a glass | Finish the wedding toast boss. | boss `toast` | M10 |
| `boss-meeting` | Back on track | Finish the interrupted meeting boss. | boss `meeting` | M10 |
| `ladder-3` | Three steps up | Complete 3 steps of your exposure ladder. | `exposure` steps done ≥ 3 | M12 |
| `stretch` | Stretch | Complete a step you rated 6 or more before. | `exposure` with `minBefore: 6`, done | M12 |
| `conversation-first` | Talking back | Finish a conversation with the partner. | `conversation` ≥ 1 with ≥ 3 learner turns | M13 |
| `conversation-pressure` | Under pressure | Finish a conversation at pressure 3. | `conversation` with `minPressure: 3` | M13 |

### Explore (`explore`)

| ID | Title | Description | Criterion | Unlocks | From |
| --- | --- | --- | --- | --- | --- |
| `all-exercises` | Well rounded | Try all four exercises. | sessions cover the 4 exercise types | — | M9 |
| `own-prompt` | Your own question | Add a prompt of your own. | user prompts ≥ 1 (facts: `userPrompts` count) | — | M9 |
| `jam-first` | Just a Minute | Play Just a Minute. | `activity` jam ≥ 1 | — | M10 |
| `jam-45` | Clean minute | Reach 45 clean seconds in Just a Minute. | jam `cleanSeconds` ≥ 45 | — | M10 |
| `jam-10-rounds` | Regular panellist | Play 10 rounds of Just a Minute. | jam ≥ 10 | — | M10 |
| `word-bomb-all` | Defused | Weave in every word in a word bomb round. | word_bomb `woven` = `shown` | — | M10 |
| `pace-three-speeds` | Three gears | Find three clearly different speeds in the pace ladder. | pace_ladder `distinctSpeeds` ≥ 3 | — | M10 |
| `emphasis-5` | Right on the beat | Reach 5 estimated hits in an emphasis game. | emphasis `estimatedHits` ≥ 5 | — | M10 |
| `daily-7` | Seven dailies | Play 7 daily prompts. | daily ≥ 7 | — | M10 |
| `daily-30` | Thirty dailies | Play 30 daily prompts. | daily ≥ 30 | — | M10 |
| `drill-sampler` | Sampler | Play 5 different drills. | distinct drill kinds ≥ 5 | pot **white glaze** | M10 |
| `all-drills` | Full deck | Play every drill. | every drill kind ≥ 1 | — | M10 |

### Phrases (`phrases`)

| ID | Title | Description | Criterion | From |
| --- | --- | --- | --- | --- |
| `phrase-in-take` | Used it | A saved phrase was spotted in one of your takes. | `phraseUses` takes ≥ 1 | M9 (needs 8.2) |
| `phrase-5-used` | Five in use | Five different saved phrases spotted in your takes. | distinct phrases ≥ 5 | M9 (needs 8.2) |
| `phrase-reviews-100` | Hundred reviews | Review phrases 100 times. | phrase reviews ≥ 100 | M9 |
| `say-it-10` | Out loud | Say 10 phrases aloud during review. | `activity` phrase_say_it takes ≥ 10 | M11 |

### Listening (`listening`)

| ID | Title | Description | Criterion | From |
| --- | --- | --- | --- | --- |
| `imitation-3-features` | Good ear | Imitate emphasis, rhythm and endings. | Listening L2 criterion | M9 |
| `ab-blind` | Blind test | Choose between two takes without knowing which is which. | a blind comparison saved | M9 (needs 8.5) |
| `catch-it` | Caught it | Catch 4 or more hesitations in one round of Catch it. | catch run with `caught` ≥ 4 | M11 |
| `upgrade-3` | Upgraded | Complete 3 upgrade loops. | `activity` upgrade retell ≥ 3 | M13 |

### Real world (`real`)

| ID | Title | Description | Criterion | From |
| --- | --- | --- | --- | --- |
| `aar` | Lessons learned | Write an after-action review. | transfer reviews of kind `aar` ≥ 1 | M12 |
| `first-mission` | On a mission | Complete a mission. | `transfers` with `mission` ≥ 1 | M14 |
| `listener-words` | In their words | Import a listener's answers. | `listenerAnswers` ≥ 1 | M14 |
| `event-done` | Showtime | Debrief an event you prepared for. | `debrief` ≥ 1 | M14 |
| `capsule-2` | Time traveller | Record two time capsules. | capsules ≥ 2 | M14 |
| `capsule-6` | Half a year | Record six time capsules. | capsules ≥ 6 | M14 |
| `capsule-12` | A year of you | Record twelve time capsules. | capsules ≥ 12 | M14 |

**Facts that achievements need beyond 7.6** (added with their milestone):
- `userPrompts` (count);
- `comparisons` (blind count);
- `catchRuns`;
- `capsules`;
- `listenerAnswers`;
- `debriefs`.

**Sanity test** (`achievements.test.ts`)
- IDs are unique and match `^[a-z0-9-]{3,40}$`.
- Titles are at most 30 characters.
- Every achievement has a criterion and an icon.
- Every `unlocks` target exists in `ACCENTS` or `POTS`.
- `offending()` finds nothing in titles or descriptions.

---

## B.3 Accents and pots

| Accent | Unlocks with | Pot | Unlocks with |
| --- | --- | --- | --- |
| green | default | clay | default |
| ocean | `goal-1` | white glaze | `drill-sampler` |
| amber | `days-10` | blue glaze | `goal-4` |
| violet | first level 3 in any area | wood | `days-100` |
| rose | `first-reflection` | stone | `goal-12` |
| graphite | `days-30` | | |

---

## B.4 Personal records

**Rules**
- **The first eligible value is stored silently.** A record is "new" only when it beats a stored value.
- **Ties don't count.**
- **Celebration:** a "card" record gets a celebration card (Full style); a "toast" record gets a toast only.

| ID | Title | Unit | Better | Eligible takes | Value | Celebrate | From |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `longest_take` | Longest take | s | higher | any saved take | speech span (or duration) in s | card | M9 |
| `longest_run` | Longest run | words | higher | transcribed with timings | `longestRun` | card | M9 (8.1) |
| `mean_run_unfamiliar` | Longest mean run, unfamiliar topic | words | higher | unfamiliar, first take, 45 s+ | `meanRun` | card | M9 (8.1) |
| `different_per_50` | Widest vocabulary | words in 50 | higher | ≥ 100 words | `differentPer50` | toast | M9 (8.1) |
| `fewest_confirmed_per_100_unfamiliar` | Fewest confirmed hesitations, unfamiliar topic | per 100 words | lower | unfamiliar, first take, 60 s+, fully reviewed | `confirmedPer100` | **toast only** (see 9.7) | M9 |
| `phrases_in_one_take` | Most saved phrases in one take | phrases | higher | transcribed | count of `phraseIds` | toast | M9 (8.2) |
| `jam_clean_seconds` | Just a Minute | clean s | higher | jam takes | result `cleanSeconds` | card | M10 |
| `word_bomb_woven` | Word bomb | words woven in | higher | word bomb takes | result `woven` | toast | M10 |
| `pace_range` | Pace range | syllables/s | higher | pace ladder with 3 rates | result `range` | toast | M10 |
| `emphasis_hits` | Emphasis | sentences | higher | emphasis game | result `estimatedHits` | toast | M10 |
| `gauntlet_rounds` | Gauntlet rounds in one go | rounds | higher | gauntlet | result `roundsCompleted` | toast | M10 |
| `conversation_turns` | Longest conversation | turns | higher | conversations | learner turns | toast | M13 |

**Display:** "Longest run · 14 words · 12 Oct (previous 11)".
- Values carry their provenance: Estimated, or Measured for duration.
- A record whose take was purged keeps its value and shows "take deleted".

---

## B.5 Quest templates

**Format**
- Progress counts only this week's facts and events.
- Titles are short and use verbs.
- Each template is either always available or needs a feature (for example, the drill templates need M10).

| ID | Title | Area | Needed | Counts | Needs |
| --- | --- | --- | --- | --- | --- |
| `unfamiliar-2` | Answer 2 unfamiliar questions | spontaneity | 2 | sessions unfamiliar | — |
| `real-1` | Have one real conversation and note it | courage | 1 | transfer reviews | — |
| `retake-3` | Record a second take in 3 sessions | fluency | 3 | sessions with ≥ 2 takes | — |
| `review-2` | Review the candidates in 2 takes | fluency | 2 | `transcript_reviewed` events | transcription |
| `phrases-10` | Review 10 phrases | vocabulary | 10 | phrase reviews | — |
| `phrase-use-1` | Use a saved phrase in a take | vocabulary | 1 | phrase uses | 8.2 |
| `imitate-1` | Imitate a clip | listening | 1 | imitate sessions | — |
| `story-1` | Tell a story | storytelling | 1 | storytelling-prompt sessions or story drills | — |
| `no-notes-1` | Speak for a minute without notes | structure | 1 | takes 60 s+ with an empty outline | — |
| `intonation-2` | Look at the intonation of 2 takes | voice | 2 | `prosodyViewed` takes | — |
| `point-first-2` | Note "point first" on 2 takes | structure | 2 | self-checks | 8.3 |
| `drill-<kind>` | Play {drill title} | the drill's first area | 1 | activity sessions of that kind | M10 |
| `daily-3` | Play the daily prompt 3 times | spontaneity | 3 | daily sessions | M10 |
| `ladder-1` | Take one step on your ladder | courage | 1 | exposure attempts done | M12 |
| `mission-1` | Complete this week's mission | courage | 1 | the mission's reflection | M14 (slot 2 when a mission is picked) |
| `partner-1` | Have a practice conversation | spontaneity | 1 | conversations ≥ 3 turns | M13 |

**Sanity test** (`quests.test.ts`):
- unique IDs;
- every area has at least one template available from M9;
- titles are at most 50 characters.
