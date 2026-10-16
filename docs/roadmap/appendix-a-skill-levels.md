# Appendix A — Skill areas and level definitions

This appendix is the source for `src/lib/engagement/skills.ts` (`AREAS`, `LEVELS`, `AREA_PRACTICE`), version **`LEVEL_DEFINITIONS_VERSION = 1`**. Criteria use the DSL from 9.2.

**Five rules every level follows:**
1. **Practice evidence only.** Levels come from task conditions, reviewed takes, your notes and a listener's words. AI suggestions never count (P-7).
2. **Earned in order.** A higher level whose criteria are met early shows as "ready".
3. **Never taken away.** A level you reach stays (A-28).
4. **Comparisons are with your own past.** Where a metric is involved, it is compared with your own early takes ("first5ReviewedMedian"), never with other people.
5. **Every level has a path that doesn't depend on a later milestone.** This holds wherever possible. `anyOf` lists alternatives, and an option whose feature isn't built yet shows "Arrives with …".

**Shorthand used in the tables:**
- **Days:** "on N days" is `distinctDays: N`; "in N weeks" is `distinctWeeks: N`.
- **Speech length:**
  - "60 s+" is `minSpeechMs: 60000`;
  - speech length is the estimated speech span when known;
  - otherwise it is the take's duration.
- **Unfamiliar answers:** "first take" (`firstTakeOnly`) is used for unfamiliar tasks, so rehearsed retries don't count as spontaneous (A-18).
- **Metrics:** names are `FactTake` fields or derived values computed in `criteria.ts` by `metricOf(take, key)`:

  | Key | Definition | Null when |
  | --- | --- | --- |
  | `confirmedPer100` | `fillersConfirmed × 100 ÷ words` | `words < 20` or the take isn't fully reviewed |
  | `midClausePauses` | from measures v2 | — |
  | `meanRun` | from measures v2 | — |
  | `differentPer50` | from measures v2 | — |

**DSL additions** (to include in 9.2's `criteria.ts`):

| Kind or field | Addition |
| --- | --- |
| `TakeFilter` | `prosodyViewed?: boolean`, `promptTags?: PromptTag[]` |
| `sessions` | `focusIn?: string[]`, `distinct?: "focus" \| "contentId"`, `promptTags?: PromptTag[]`, `minTakes?: number` |
| `transfers` | `mission?: boolean` |
| `conversation` | `minPressure?: 0 \| 1 \| 2 \| 3` |
| `listenerAnswers` (new kind) | `{ kind: "listenerAnswers"; label; atLeast; mainPointAnswered?: boolean }` (facts from M14) |

`EvalContext.promptTags` maps each prompt ID to its tags, built from `listPrompts()`, so criteria can ask for "storytelling prompts".

---

## Areas

| ID | Title | Icon (lucide) | Trains | Why it matters (shown in the area sheet) |
| --- | --- | --- | --- | --- |
| `structure` | Structure & clarity | `ListOrdered` | Point first, reason and example, a clear ending | Listeners follow a point they hear early. Structure is the fastest way to be understood. |
| `fluency` | Fluency | `Waves` | Noticing hesitations, pausing instead, steady flow | Hesitation is normal in a second language. Noticing it and pausing calmly helps listeners more than rushing. |
| `voice` | Voice & delivery | `AudioLines` | Endings, rhythm, pace range, emphasis | Where your voice rises, falls and stresses carries meaning beyond the words. |
| `spontaneity` | Spontaneity | `Zap` | Unfamiliar topics, little preparation, follow-ups | Real conversations rarely give you time to prepare. Practising without notes transfers best. |
| `vocabulary` | Vocabulary & phrasing | `BookOpenText` | Saving, reviewing and using natural expressions | A phrase you have said aloud in your own sentence comes back when you need it. |
| `listening` | Listening & imitation | `Ear` | Shadowing, imitating features, learning from models | Copying a model trains your ear and your mouth together. |
| `storytelling` | Storytelling | `ScrollText` | Sequence, concrete detail, telling on the spot | Stories are how people remember what you said. |
| `courage` | Real-world courage | `Flag` | Real conversations, graded steps, events | Practice counts most when it reaches real people. |

---

## Structure & clarity

| Level | Name | Criteria | Practise this |
| --- | --- | --- | --- |
| 1 | Point first | `sessions` with outline point filled, ≥ 3 · label: "3 sessions where you wrote your point in the outline" | Record and repeat (open the outline) |
| 2 | Reason and example | `sessions` with outline point + reason + example, `minTakes: 1`, ≥ 3, on 2 days · label: "3 sessions with a point, a reason and an example, on 2 days" | Record and repeat |
| 3 | Clear ending | `takes` with check `clear_ending` = yes, ≥ 3, on 2 days · label: "3 takes where you noted a clear ending" · *from M8* | Elevator pitch; any take's self-check |
| 4 | Structured on the spot | `takes` with familiarity unfamiliar, `maxPrepSeconds: 15`, `firstTakeOnly`, check `point_first` = yes, ≥ 3, on 2 days · *from M8* | Topic roulette; this week's new situation |
| 5 | Understood | `anyOf`:<br>(a) `transfers` with `listenerWords` and `noClarification`, ≥ 2<br>(b) `listenerAnswers` with `mainPointAnswered`, ≥ 2 (*M14*)<br>Label: "Twice, a listener told you your main point without asking what you meant" | Real conversations; Ask a listener |

## Fluency

| Level | Name | Criteria | Practise this |
| --- | --- | --- | --- |
| 1 | Aware | `takes` transcribed with `fillersReviewed`, ≥ 3 · label: "Review the hesitation candidates in 3 takes (a take with none counts)" · unavailable without transcription: fix `transcription` | Review a take; Catch it (*M11*) |
| 2 | Replacing | `takes` with `fillersReviewed`, 45 s+, metric `confirmedPer100` ≤ 0.7 × first5ReviewedMedian, ≥ 3, on 2 days · label: "3 reviewed takes with clearly fewer confirmed hesitations than your first five" · baseline needs 5 reviewed takes: fix `review` · if your baseline median is 0, the metric part is met by `confirmedPer100` = 0 | Filler programme (*M11*); record with the focus "Pause instead of um" |
| 3 | Steady | `takes` familiar, 60 s+, metric `midClausePauses` ≤ 1, ≥ 2 · label: "2 familiar answers of a minute or more with at most one pause inside a clause" · *from M8* | Just a Minute on a familiar topic |
| 4 | Under pressure | `anyOf`:<br>(a) `takes` unfamiliar, `maxPrepSeconds: 15`, `firstTakeOnly`, 60 s+, `midClausePauses` ≤ 1, ≥ 2, on 2 days<br>(b) `activity` `jam` with result `cleanSeconds` ≥ 45, ≥ 2 (*M10*) | Just a Minute; Topic roulette |
| 5 | Natural | `allOf`:<br>(a) `transfers` with flow `smooth`, ≥ 2<br>(b) `anyOf`: `conversation` `minTurns: 5` ≥ 1 (*M13*), or `sessions` with `followUp`, `minTakes: 2`, ≥ 3<br>Label: "Two real conversations that flowed, plus follow-up practice" | Partner; follow-up prompts |

## Voice & delivery

| Level | Name | Criteria | Practise this |
| --- | --- | --- | --- |
| 1 | Listening back | `takes` with `prosodyViewed`, ≥ 3 · label: "Open the intonation track of 3 takes" | Session review → Intonation |
| 2 | Shaping endings | `sessions` exercise imitate, `minTakes: 2`, ≥ 3, on 2 days · label: "3 imitation sessions with two or more takes" | Listen and imitate |
| 3 | Range | `activity` `pace_ladder` with result `distinctSpeeds` ≥ 3, ≥ 1 · label: "Three clearly different speeds in the pace ladder" · *from M10* | Pace ladder |
| 4 | Emphasis | `activity` `emphasis` with result `estimatedHits` ≥ 5, ≥ 2, on 2 days · *from M10* | Emphasis game |
| 5 | Expressive | `allOf`:<br>(a) `takes` 90 s+ with check `varied_voice` = yes, ≥ 2 (the third self-check, shown on takes of 90 s or more)<br>(b) `anyOf`: `activity` `rehearsal` ≥ 1 (*M14*), `activity` `boss` ≥ 1 (*M10*), `conversation` `minTurns: 5` ≥ 1 (*M13*) | Talk rehearsal; boss levels |

## Spontaneity

| Level | Name | Criteria | Practise this |
| --- | --- | --- | --- |
| 1 | First unknown | `sessions` unfamiliar, ≥ 1 | This week's new situation |
| 2 | Short notice | `sessions` unfamiliar with `maxPrepSeconds: 30`, ≥ 3, on 2 days | Unfamiliar prompts (Exercises → Prompts) |
| 3 | No notice | `anyOf`:<br>(a) `sessions` unfamiliar, `maxPrepSeconds: 10`, ≥ 3, on 2 days<br>(b) `activity` `roulette`, ≥ 3, on 2 days (*M10*) | Topic roulette |
| 4 | Follow-ups | `sessions` with `followUp`, `minTakes: 2`, ≥ 3, on 2 days · label: "Answer follow-up questions in 3 sessions" | Follow-up prompts (stage 5); AI follow-up |
| 5 | Gauntlet | `anyOf`:<br>(a) `activity` `gauntlet` with result `roundsCompleted` ≥ 5, ≥ 1 (*M10*)<br>(b) `conversation` `minTurns: 6`, ≥ 1 (*M13*) | Gauntlet; Partner |

## Vocabulary & phrasing

| Level | Name | Criteria | Practise this |
| --- | --- | --- | --- |
| 1 | Collector | `phrases` saved ≥ 5 (starter cards excluded) | Save phrases from sessions or AI suggestions |
| 2 | Reviewer | `phrases` reviews ≥ 20, review days ≥ 5 | Phrases → review |
| 3 | User | `phraseUses` takes ≥ 3 · label: "A saved phrase spotted in 3 takes" · *from M8* | Use a better expression; Say it (*M11*) |
| 4 | Range | `phraseUses` distinct phrases ≥ 5 · *from M8* | Use a better expression |
| 5 | Natural use | `phraseUses` `unfamiliarOnly`, distinct phrases ≥ 3 · label: "3 different saved phrases used in unfamiliar answers" | Unfamiliar prompts |

## Listening & imitation

| Level | Name | Criteria | Practise this |
| --- | --- | --- | --- |
| 1 | First echo | `sessions` exercise imitate, ≥ 1 | Listen and imitate |
| 2 | Three features | `sessions` imitate with `focusIn: IMITATION_FEATURES`, `distinct: "focus"`, ≥ 3 · label: "Imitate emphasis, rhythm and endings" · **implementation note:** the imitation panel must save the chosen feature as the session focus. Check `ImitationPanel` and add it if missing. | Listen and imitate |
| 3 | Regular | `sessions` imitate, ≥ 5, on 3 days | Listen and imitate |
| 4 | Shadowing | `sessions` imitate, `minTakes: 3`, ≥ 3 | Listen and imitate (three takes) |
| 5 | Upgrade | `anyOf`:<br>(a) `activity` `upgrade` with a `retell` take, ≥ 3 (*M13*)<br>(b) `sessions` imitate, ≥ 10, on 5 days | Upgrade loop |

## Storytelling

| Level | Name | Criteria | Practise this |
| --- | --- | --- | --- |
| 1 | First story | `sessions` with prompt tag `storytelling`, ≥ 1 | Storytelling prompts |
| 2 | Story spine | `anyOf`:<br>(a) `activity` `story_spine`, ≥ 2 (*M10*)<br>(b) `sessions` with prompt tag `storytelling`, ≥ 3, on 2 days | Story spine |
| 3 | Concrete detail | `takes` 60 s+ with check `concrete_detail` = yes, ≥ 3, on 2 days · the self-check shows on storytelling takes and story drills | Story spine |
| 4 | On the spot | `activity` `story_cubes`, ≥ 3, on 2 days · *from M10* | Story cubes |
| 5 | Told for real | `transfers` tagged `story`, ≥ 2 · label: "Tell a story in 2 real conversations and note it" | Mission: tell a one-minute story at dinner (*M14*) |

## Real-world courage

| Level | Name | Criteria | Practise this |
| --- | --- | --- | --- |
| 1 | First reflection | `transfers`, ≥ 1 | Real conversations |
| 2 | Regular | `transfers`, ≥ 3, in 3 weeks | Real conversations |
| 3 | Stepping up | `anyOf`:<br>(a) `exposure` steps done ≥ 3 (*M12*)<br>(b) `transfers` with `mission`, ≥ 3 (*M14*)<br>(c) `transfers`, ≥ 5 | Exposure ladder; missions |
| 4 | Stretch | `anyOf`:<br>(a) `exposure` with `minBefore: 6`, done ≥ 1 (*M12*)<br>(b) `activity` `boss`, ≥ 1 (*M10*)<br>(c) `conversation` `minTurns: 6`, `minPressure: 2`, ≥ 1 (*M13*)<br>Label: "Do one thing that felt like a real stretch" | Exposure ladder; boss levels |
| 5 | Event | `anyOf`:<br>(a) `debrief`, ≥ 1 (*M14*: an event with its debrief written)<br>(b) `transfers`, ≥ 10, in 6 weeks | Events |

---

## `AREA_PRACTICE` (sprint and "Practise this" links)

```ts
export const AREA_PRACTICE: Record<AreaId, Record<1 | 2 | 3 | 4 | 5, PractiseLink[]>> = {
  structure:    { 1: [repeatWithOutline], 2: [repeatWithOutline], 3: [drill("pitch")], 4: [drill("roulette"), weeklyNewSituation], 5: [realConversation, askListener] },
  fluency:      { 1: [reviewLatestTake, catchIt], 2: [programme("fillers-4w"), repeatWithFocus("Pause instead of um")], 3: [drill("jam")], 4: [drill("jam"), drill("roulette")], 5: [partner("small-talk"), followUpPrompt] },
  voice:        { 1: [openIntonation], 2: [exercise("ex-imitate")], 3: [drill("pace_ladder")], 4: [drill("emphasis")], 5: [rehearseTalk, boss("toast")] },
  spontaneity:  { 1: [weeklyNewSituation], 2: [unfamiliarPrompt], 3: [drill("roulette")], 4: [followUpPrompt], 5: [drill("gauntlet"), partner("meeting-update")] },
  vocabulary:   { 1: [phrases], 2: [phraseReview], 3: [exercise("ex-expression"), sayIt], 4: [exercise("ex-expression")], 5: [unfamiliarPrompt] },
  listening:    { 1: [exercise("ex-imitate")], 2: [exercise("ex-imitate")], 3: [exercise("ex-imitate")], 4: [exercise("ex-imitate")], 5: [upgradeLatestTake] },
  storytelling: { 1: [storyPrompt], 2: [drill("story_spine")], 3: [drill("story_spine")], 4: [drill("story_cubes")], 5: [mission("dinner-story")] },
  courage:      { 1: [realConversation], 2: [realConversation], 3: [exposureLadder, missions], 4: [exposureLadder, boss("meeting")], 5: [events] },
};
```
- Links whose feature isn't built yet are filtered out by `available(link)`.
- If nothing is left for a level, the sheet shows the criterion's own label as the instruction.
