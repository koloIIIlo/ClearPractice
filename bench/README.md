# M0 offline transcription feasibility

`whisper-assets.json` pins the official release archives and the two existing models. No model weights are downloaded by this workflow. Run commands from the repository root with PowerShell 7. Runtime downloads, configurations containing local paths, recordings, and raw transcripts stay in ignored `runtime.local/` and `samples/` folders.

Prepare verified runtime files and native configurations:

```powershell
./bench/Prepare-Whisper.ps1 -ModelFolder 'YOUR_EXISTING_MODELS_FOLDER' -Cuda
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo build --manifest-path src-tauri/Cargo.toml --locked --bin whisper-bench
./src-tauri/target/debug/whisper-bench.exe ./bench/runtime.local/config-cpu-base.json ./bench/samples/jfk.wav ./bench/runtime.local/new-cpu-run benchmark
```

Use a **new output directory** per invocation. `verify` makes one run; `benchmark` makes an initial run and three subsequent process runs. Other configurations select CUDA or `large-v3-turbo-q5_0`. Each run checks the executable, DLLs, and model; derives verified inference audio; launches the worker below normal priority; receives bounded progress; validates JSON; and saves raw plus normalized results. Cancellation kills/reaps the worker, and the harness verifies source preservation and checksum rejection. A requested CUDA run fails if the worker does not report using CUDA; it does not count a CPU fallback as a GPU measurement.

The report records worker elapsed time, total job time including integrity/preparation, and Windows peak working-set RAM. The initial trial's OS/model cache state is not controlled; do not label it a proven cold disk run. Peak per-process VRAM is currently unavailable. Segment times are **Estimated**; out-of-range times become `null` with a reason. Empty/no-speech output fails while retaining audio. Token timings are retained in raw JSON but are not presented as validated word alignment. Successful runs also save provider-neutral `transcription.json` with explicit capability/unknown-field reasons.

## Current public benchmark (user-selected substitute)

The completed six-profile comparison and its limits are in [results-2026-10.md](results-2026-10.md), with machine-readable measurements in `results-2026-10.json`. `selected-profile.json` records the provisional CUDA turbo/filler-prompt choice. Setup writes `runtime.local/config-selected.json`; without `-Cuda`, it uses the explicit CPU base alternative. Run `python bench/summarize.py` after scoring all six run folders to reproduce the aggregate without raw transcript text or local paths.

On 4 October the user requested downloaded internet speech instead of a personal recording. The selected [Nyra Disfluency Speech English dataset](https://huggingface.co/datasets/nyralabs/disfluency_speech_english) declares Apache-2.0 and provides independent verbatim/intended transcripts. `public-fixture.json` pins eight clip IDs, audio hashes and verbatim-reference hashes. Complete clips total 61.934 seconds; concatenation adds no silence and trims nothing. This is multiple utterances/speakers, not a continuous explanation or a measure of the user's accent/accuracy. The official JFK clip remains only a protocol fixture.

```powershell
./bench/Fetch-PublicSample.ps1
python ./bench/public_sample.py test
python ./bench/public_sample.py prepare ./bench/samples
./src-tauri/target/debug/whisper-bench.exe ./bench/runtime.local/config-cpu-base.json ./bench/samples/public-62s.wav ./bench/runtime.local/NEW-public-run benchmark
python ./bench/public_sample.py score ./bench/samples/public-62s-reference.json ./bench/runtime.local/NEW-public-run
```

The scorer verifies exact PCM/reference identity and computes deterministic word edit alignment. Verbatim WER retains repetitions/restarts, with punctuation/annotation syntax normalized; ordinary WER excludes UH/UM. Filler recall/false insertions count explicit UH/UM only. Ambiguous “like” and “you know” are not automatically counted. Reference clip boundaries are Estimated; there are no independent word timestamps. Inspect output for hallucination loops before interpreting the figures. Audio, signed download links, full references, local paths and raw outputs remain ignored. Do not overwrite an existing composed fixture or run directory.

## Optional later personal check

Do not block this user's current benchmark by requesting personal audio again. A personal comparison can be added later if they choose:

1. Record a roughly 60-second spontaneous English explanation in Studio. Keep natural fillers, repetitions, restarts, and pauses. Stop and verify playback.
2. Hand-transcribe exactly what was said, including each “um”, “uh”, repetition, and restart. Mark approximate audio times. Preserve this independently of any model output.
3. Prepare the saved take through the native `audio::prepare` path. The development harness accepts 16 kHz, mono, 16-bit PCM WAV; it preserves its own input as a journaled asset.
4. Run all verified existing CPU/CUDA candidates with the same settings and one initial plus three warm trials. Record power mode, plugged-in status, multitasking load, RAM and VRAM availability. Repeat the chosen candidate under normal multitasking.
5. Make a separate configuration with `prompt` set to a short filler-bearing example. Preserve separate outputs. Compare ordinary word errors, hand-verified filler recall/false insertions, and hallucination/repetition loops; do not treat every “like” as a filler.
6. Record measurements in `DEVELOPMENT_PLAN.md` before revising D-4, D-5, or D-16. English-only extra weights and CrisperWhisper remain separate decisions after existing-pack results.

The worker is a feasibility module, not yet wired into the product's Review/job UI. SQLite job persistence, pack-import UI, packaged sidecar/redistribution review, and the shared Local/API owner follow in their planned milestones. The harness never submits audio or requests to an API.
