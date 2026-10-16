# Appendix E: Metrics glossary and research references

## E.1 Metrics glossary

Every value the roadmap adds is listed here with its definition, provenance, the condition that makes it unavailable, and where it is computed.

**Where the v1 measures stand.** The existing measures (pace, pauses ≥ 700 ms, filler candidates, repeated words) stay defined as in blueprint §11 and `analysis.rs` v1.

| Value | Definition | Provenance | Unavailable when | Computed in |
| --- | --- | --- | --- | --- |
| Mean run | Words in runs ÷ number of runs. A run is a sequence of timed segments whose gaps are under 700 ms. | Estimated | No timed segments, or fewer than 20 words | `analysis.rs` v2 (8.1) |
| Longest run | Most words in one run | Estimated | Same as mean run | 8.1 |
| Pauses inside a clause / between clauses | Each pause between segments is classed by the previous segment's end punctuation, or by the next segment starting with a clause starter | Estimated | Pauses unavailable | 8.1 |
| Words you use often | Counts of the default watch list and your own words, per 100 words | Estimated | Fewer than 20 words | 8.1, `words.ts` |
| Hedges | Counts of the hedge list, per 100 words | Estimated | Fewer than 20 words | 8.1 |
| Different words per 50 | Mean distinct words per 50-word moving window, fillers excluded (MATTR) | Estimated | Fewer than 50 words | 8.1 |
| Opener / ending hint | The first token is a filler candidate, or the last tokens match a trailing phrase | Estimated | Empty transcript | 8.1 |
| Phrase used | Your saved expression matched in the transcript (stems, articles, placeholders) | Estimated | No transcript | 8.2 |
| Speech rate (audio) | Syllable nuclei ÷ the span from the first to the last nucleus | Estimated | Fewer than 10 nuclei, or a span under 5 s | `syllables.rs` (8.8) |
| Articulation rate | Nuclei ÷ phonation time (the span minus pauses ≥ 300 ms) | Estimated | As above | 8.8 |
| Live pace | Nuclei in the last 8 s ÷ voiced time in that window | Estimated | Less than 3 s voiced | 8.8 |
| Confirmed hesitations per 100 words | Confirmed candidates × 100 ÷ words. **Fully reviewed takes only.** | Estimated (your review of estimated candidates) | Not fully reviewed, or fewer than 20 words | `criteria.ts` `metricOf` |
| Clean seconds (JAM) | Speaking time (≤ 60 s) minus penalties (1 s per candidate, pause durations ≥ 1.5 s, 0.5 s per repeat, 1 s per flag) | Estimated | No transcript (pauses and flags are still shown) | `activity_results.rs` (10.2) |
| Words woven in | Shown words whose stem appears in a segment starting at or after the time shown minus 1 s | Estimated | No transcript (your note instead) | 10.4 |
| Strongest beat | The nucleus with the highest z(dB) + z(f0 in semitones) + 0.5·z(voiced length), mapped to a word by estimated syllables | Estimated | Nuclei count off by more than 25% from the expected syllables | `prosody.rs` (10.6) |
| Distinct speeds | Count of the slow < natural < fast gaps that are at least 0.4 syllables/s, plus one | Estimated | Fewer than 3 rates | 10.7 |
| Daily grid | 10 s windows classed flowing / hesitation / pause / silent | Estimated | No transcript (pause and silent only) | 10.11 |
| Discomfort | Your 0–10 rating before and after an exposure step | Your note | — | 12.2 |
| Ease | Your 1–5 rating after a session (existing) | Your note | — | 4.11 |
| Flow | Your "smooth / mixed / with effort" after a real conversation | Your note | — | 9.16 |
| Predictions | Your guess of hesitations and pace before seeing the take's values | Your note | — | 11.5 |
| Caught (Catch it) | Presses that fall inside a segment containing a confirmed filler, each filler matched once | Estimated | Fewer than 3 confirmed fillers | 11.6 |
| Section times | From your section marks to the next mark (talk rehearsal) | Measured (marks) / Estimated (segment assignment) | No marks: all time goes to section 1, with a note | 14.3 |

## E.2 Research references

> These papers back the design choices. Check a reference against the original before quoting it in the app's Help. The app's UI makes no claims about outcomes (blueprint §1).

### Motivation, feedback and rewards
- **Kluger, A. N., & DeNisi, A. (1996).** The effects of feedback interventions on performance: A historical review, a meta-analysis, and a preliminary feedback intervention theory. *Psychological Bulletin, 119*(2), 254–284.
  - Over a third of feedback interventions lowered performance; feedback directed at the self rather than the task tends to hurt.
  - Used by: P-1 and the celebration copy.
- **Deci, E. L., Koestner, R., & Ryan, R. M. (1999).** A meta-analytic review of experiments examining the effects of extrinsic rewards on intrinsic motivation. *Psychological Bulletin, 125*(6), 627–668.
  - Rewards that feel controlling can reduce intrinsic motivation.
  - Used by: XP for effort, no pressure language.
- **Ryan, R. M., & Deci, E. L. (2000).** Self-determination theory and the facilitation of intrinsic motivation, social development, and well-being. *American Psychologist, 55*(1), 68–78.
  - Autonomy, competence and relatedness support motivation.
  - Used by: P-4 (choices, swaps, soft locks).
- **Nunes, J. C., & Drèze, X. (2006).** The endowed progress effect: How artificial advancement increases effort. *Journal of Consumer Research, 32*(4), 504–512.
  - Used by: the head start from backfilled history (7.4).
- **Kivetz, R., Urminsky, O., & Zheng, Y. (2006).** The goal-gradient hypothesis resurrected. *Journal of Marketing Research, 43*(1), 39–58.
  - Used by: progress bars, and "Next: 1 more take".
- **Dai, H., Milkman, K. L., & Riis, J. (2014).** The fresh start effect: Temporal landmarks motivate aspirational behavior. *Management Science, 60*(10), 2563–2582.
  - Used by: Mondays, month starts, comebacks (9.13).
- **Lally, P., van Jaarsveld, C. H. M., Potts, H. W. W., & Wardle, J. (2010).** How are habits formed: Modelling habit formation in the real world. *European Journal of Social Psychology, 40*(6), 998–1009.
  - A median of 66 days to automaticity; missing one opportunity did not materially affect the process.
  - Used by: the weekly goal instead of a daily streak (9.8).
- **Gollwitzer, P. M., Sheeran, P., Michalski, V., & Seifert, A. E. (2009).** When intentions go public: Does social reality widen the intention–behavior gap? *Psychological Science, 20*(5), 612–618.
  - Used by: private by default; share what you did, not intentions (M15).
- **Bandura, A. (1977).** Self-efficacy: Toward a unifying theory of behavioral change. *Psychological Review, 84*(2), 191–215.
  - Used by: mastery experiences, best moments and records.

### Learning science
- **Ericsson, K. A., Krampe, R. T., & Tesch-Römer, C. (1993).** The role of deliberate practice in the acquisition of expert performance. *Psychological Review, 100*(3), 363–406.
  - Used by: focused practice, the weakest-area sprint.
- **Wilson, R. C., Shenhav, A., Straccia, M., & Cohen, J. D. (2019).** The Eighty Five Percent Rule for optimal learning. *Nature Communications, 10*, 4646.
  - Used by: the challenge dial and tuning (11.2).
- **Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D. (2006).** Distributed practice in verbal recall tasks: A review and quantitative synthesis. *Psychological Bulletin, 132*(3), 354–380.
  - Used by: re-answering (11.1) and event plans (14.2).
- **Roediger, H. L., & Karpicke, J. D. (2006).** Test-enhanced learning: Taking memory tests improves long-term retention. *Psychological Science, 17*(3), 249–255.
  - Used by: re-answering and retelling.
- **Rohrer, D., & Taylor, K. (2007).** The shuffling of mathematics problems improves learning. *Instructional Science, 35*(6), 481–498.
  - Used by: interleaving (11.3).
- **Brunmair, M., & Richter, T. (2019).** Similarity matters: A meta-analysis of interleaved learning and its moderators. *Psychological Bulletin, 145*(11), 1029–1052.
  - Used by: interleaving, with the caveat that the benefit varies.
- **Chiviacowsky, S., & Wulf, G. (2002).** Self-controlled feedback: Does it enhance learning because performers get feedback when they need it? *Research Quarterly for Exercise and Sport, 73*(4), 408–415.
  - Used by: feedback timing (11.4).
- **Dunlosky, J., & Rawson, K. A. (2012).** Overconfidence produces underachievement: Inaccurate self evaluations undermine students' learning and retention. *Learning and Instruction, 22*(4), 271–280.
  - Used by: predict, then check (11.5).
- **MacLeod, C. M., Gopie, N., Hourihan, K. L., Neary, K. R., & Ozubko, J. D. (2010).** The production effect: Delineation of a phenomenon. *Journal of Experimental Psychology: Learning, Memory, and Cognition, 36*(3), 671–685.
  - Used by: phrases said aloud (11.7).

### Fluency and second-language speech
- **Kormos, J., & Dénes, M. (2004).** Exploring measures and perceptions of fluency in the speech of second language learners. *System, 32*(2), 145–164.
  - Used by: mean length of run and related measures (8.1).
- **Tavakoli, P. (2011).** Pausing patterns: Differences between L2 learners and native speakers. *ELT Journal, 65*(1), 71–79.
  - Used by: pause location, inside a clause or between clauses (8.1).
- **de Jong, N. H., & Wempe, T. (2009).** Praat script to detect syllable nuclei and measure speech rate automatically. *Behavior Research Methods, 41*(2), 385–390.
  - Used by: syllable rate and live pace (8.8).
- **Covington, M. A., & McFall, J. D. (2010).** Cutting the Gordian knot: The moving-average type–token ratio (MATTR). *Journal of Quantitative Linguistics, 17*(2), 94–100.
  - Used by: different words per 50 (8.1).
- **Munro, M. J., & Derwing, T. M. (1995).** Foreign accent, comprehensibility, and intelligibility in the speech of second language learners. *Language Learning, 45*(1), 73–97.
  - Used by: being understood over sounding native, and no accent scores.

### Fillers and habits
- **Azrin, N. H., & Nunn, R. G. (1973).** Habit-reversal: A method of eliminating nervous habits and tics. *Behaviour Research and Therapy, 11*(4), 619–628.
- **Mancuso, C., & Miltenberger, R. G. (2016).** Using habit reversal to decrease filled pauses in public speaking. *Journal of Applied Behavior Analysis, 49*(1), 188–192.
  - Used by: the filler programme and Catch it (11.6).

### Confidence and performance anxiety
- **Ebrahimi, O. V., Pallesen, S., Kenter, R. M. F., & Nordgreen, T. (2019).** Psychological interventions for the fear of public speaking: A meta-analysis. *Frontiers in Psychology, 10*, 488.
  - Used by: the exposure ladder (12.2).
- **Meichenbaum, D. (1985).** *Stress inoculation training.* Pergamon Press.
- **Saunders, T., Driskell, J. E., Johnston, J. H., & Salas, E. (1996).** The effect of stress inoculation training on anxiety and performance. *Journal of Occupational Health Psychology, 1*(2), 170–186.
  - Used by: the pressure dial (13.5).
- **Balban, M. Y., Neri, E., Kogon, M. M., et al. (2023).** Brief structured respiration practices enhance mood and reduce physiological arousal. *Cell Reports Medicine, 4*(1), 100895.
  - Used by: cyclic sighing (12.3).
- **Brooks, A. W. (2014).** Get excited: Reappraising pre-performance anxiety as excitement. *Journal of Experimental Psychology: General, 143*(3), 1144–1158.
  - Used by: the reframe step (12.3).
- **Ramirez, G., & Beilock, S. L. (2011).** Writing about testing worries boosts exam performance in the classroom. *Science, 331*(6014), 211–213.
  - Used by: the worry dump (12.3).
- **Kross, E., Bruehlman-Senecal, E., Park, J., et al. (2014).** Self-talk as a regulatory mechanism: How you do it matters. *Journal of Personality and Social Psychology, 106*(2), 304–324.
  - Used by: name-based self-talk (12.3).
- **Dowrick, P. W. (1999).** A review of self modeling and related interventions. *Applied and Preventive Psychology, 8*(1), 23–39.
  - Used by: the best-moments reel (12.5).
- **Ranehill, E., Dreber, A., Johannesson, M., Leiberg, S., Sul, S., & Weber, R. A. (2015).** Assessing the robustness of power posing: No effect on hormones and risk tolerance in a large sample of men and women. *Psychological Science, 26*(5), 653–656.
  - Used by: the decision to leave power poses out.

### Product inspirations (not research)
- Duolingo: path, quests, the daily goal; the hearts and leagues were deliberately left out.
- Khan Academy: mastery levels and energy points.
- Strava: personal records.
- Finch and Forest: a companion that grows.
- Keybr: drills on your weakest letters.
- BBC Radio 4 *Just a Minute*.
- Toastmasters: Table Topics, the timer lights, the Ah-counter, and the commend–recommend–commend evaluation.
- PowerPoint Speaker Coach: the rehearsal report.
- Wordle: one daily puzzle and the share grid.
- Couch to 5K: the event plan.
- Yoodli, Speak, Praktika and Duolingo Video Call: AI conversation practice.
