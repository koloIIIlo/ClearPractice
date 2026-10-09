# Local transcription comparison — 7 October 2026

Measured on the development laptop using the pinned public fixture. Each profile has an initial process and three subsequent processes. OS/model caches were uncontrolled; the initial run is not a proven cold start.

| Profile | First worker / total (s) | Warm worker / total median (s) | Ordinary WER | UH/UM retained | Inserted | Peak working set (MiB) |
| --- | --- | --- | --- | --- | --- | --- |
| public-cpu-base | 27.52 / 30.09 | 28.60 / 29.04 | 15.00% | 0/14 | 0 | 367.8 |
| public-cpu-turbo | 184.33 / 188.77 | 170.25 / 170.95 | 5.00% | 0/14 | 0 | 914.7 |
| public-cpu-base-fillers-v2 | 64.97 / 71.33 | 60.21 / 60.89 | 11.11% | 1/14 | 0 | 398.3 |
| public-cuda-base-v2 | 5.09 / 8.01 | 4.74 / 6.54 | 15.00% | 0/14 | 0 | 363.4 |
| public-cuda-turbo | 62.84 / 71.02 | 10.67 / 12.98 | 5.00% | 0/14 | 0 | 643.2 |
| public-cuda-turbo-fillers | 11.86 / 14.41 | 11.53 / 14.02 | 1.11% | 13/14 | 0 | 380.2 |

Selected: large-v3-turbo-q5_0, CUDA, four threads, initial prompt `Umm, so, uh, I think, like, you know.`. All four selected-profile trials produced 3/194 verbatim word errors, 13/14 retained UH/UM, and zero inserted UH/UM. CPU base is an explicit smaller alternative, never an automatic fallback.

This small public sample does not establish personal accuracy or verified word alignment. Ambiguous ‘like’ and ‘you know’ are excluded from filler counts. All detected fillers require review. Out-of-range segment timing remains unavailable rather than clamped. Per-process VRAM is unavailable with a reason. The older slow JFK GPU result was not reproduced; its cause remains unknown. Some CPU filler trials overlapped development checks.

CrisperWhisper is deferred: its custom adapter and noncommercial model licence need separate evaluation. No additional model download is required for the selected profile. Packaging and redistribution review remain M6 work.

## Cloud transcription: AssemblyAI Universal-3.5 Pro (0.23, 9 October 2026)

The same public 62 s fixture, imported into the app and sent once after the in-app preview and the user's Send (`disfluencies: true`, English). Scored with `public_sample.py score-api` from the result the app kept (`results-api-assemblyai-2026-10.json`).

| Measure | AssemblyAI Universal-3.5 Pro | Local selected (turbo, CUDA) |
| --- | --- | --- |
| Verbatim word errors | 4 / 194 (2.1%) | 3 / 194 (1.5%) |
| Ordinary word error rate (fillers excluded) | 1.1% | — |
| UH/UM kept | 13 / 14 | 13 / 14 |
| UH/UM inserted | 1 (the missing "uh" placed one word away, so counted as one omission and one insertion) | 0 |
| Other differences | "papyrus" heard as "peppers"; "huh" omitted | — |
| Word timings | 193 words, in order, inside the audio (0.0–61.9 s) | Segment timings only |
| Time from Send to result | 12.8 s (upload, processing, polling) | 14.0 s warm total |
| Cost | USD 0.007 recorded (list price, two started minutes; covered by free credit) | none |

Deepgram Nova-3 was not measured: no key. Personal accuracy remains unknown (public fixture, D-24).

## Pitch tracker against Praat (gate P, 9 October 2026)

ClearPractice's YIN contour (yin-v1: 40 ms window, 10 ms hop, 60–500 Hz, threshold 0.15) against Praat 7.0.02 `To Pitch (ac)` (10 ms step, 60–500 Hz, default thresholds) on 11 recordings: the 8 public disfluency clips (8 speakers), the JFK sample and two bundled VOA clips. Frames matched to the nearest Praat frame within 5 ms. `bench/pitch_vs_praat.py`, results in `results-pitch-vs-praat-2026-10.json`.

| YIN threshold | Frames voiced by both | Octave errors | Within 1 semitone | Voiced only by Praat | Voiced only by YIN |
| --- | --- | --- | --- | --- | --- |
| **0.15 (shipped)** | 4,033 | **12 (0.30%)**, 8 of them in the noisy JFK recording | **99.6%** (median difference 0.02 st) | 1,719 | 40 |
| 0.20 | 4,448 | 27 (0.61%) | 99.1% | 1,304 | 75 |
| 0.25 | 4,765 | 38 (0.80%) | 98.2% | 987 | 100 |

No systematic octave errors: gate P passes and D-17 (YIN) is confirmed. YIN is more cautious than Praat about calling a frame voiced (about 30% of Praat's voiced frames show as gaps); loosening the threshold closes some of that gap but doubles the octave errors, so 0.15 stays: a gap is honest, a wrong octave is misleading.
