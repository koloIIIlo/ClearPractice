"""Publish measurements without audio, transcript text, or machine-specific paths."""
import json
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parent
RUNS = ["public-cpu-base", "public-cpu-turbo", "public-cpu-base-fillers-v2",
        "public-cuda-base-v2", "public-cuda-turbo", "public-cuda-turbo-fillers"]
out = {"version": 1, "createdOn": "2026-10-07",
       "source": "Public Nyra Disfluency Speech English subset; eight complete clips, 61.934s",
       "personalAccuracy": None, "personalAccuracyUnavailableReason": "Public sample substituted at user request",
       "runs": []}
for name in RUNS:
    folder = ROOT / "runtime.local" / name
    timing = json.loads((folder / "benchmark.json").read_text(encoding="utf-8-sig"))
    quality = json.loads((folder / "quality.json").read_text(encoding="utf-8-sig"))
    record = {k: timing[k] for k in ["backend", "durationMs", "sourceSha256", "modelSha256",
        "runtimeVersion", "threads", "prompt", "trials", "warmMedianMs", "warmMinMs", "warmMaxMs",
        "firstTrial", "cancellationVerified", "checksumRejectionVerified", "originalPreserved"]}
    record.update(run=name, model=timing["modelId"],
        warmMedianTotalJobMs=median(t["totalJobMs"] for t in timing["trials"][1:]),
        peakRamBytes=max(t["peakRamBytes"] for t in timing["trials"]),
        peakVramBytes=None, peakVramUnavailableReason="NVIDIA WDDM per-process query returned N/A; device-wide snapshot is not a process peak",
        qualityTrials=quality["trials"])
    assert len(record["trials"]) == len(record["qualityTrials"]) == 4
    out["runs"].append(record)
(ROOT / "results-2026-10.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
lines = ["# Local transcription comparison — 7 October 2026", "",
    "Measured on the development laptop using the pinned public fixture. Each profile has an initial process and three subsequent processes. OS/model caches were uncontrolled; the initial run is not a proven cold start.", "",
    "| Profile | First worker / total (s) | Warm worker / total median (s) | Ordinary WER | UH/UM retained | Inserted | Peak working set (MiB) |",
    "| --- | --- | --- | --- | --- | --- | --- |"]
for r in out["runs"]:
    q = r["qualityTrials"][0]
    t = r["trials"][0]
    lines.append(f'| {r["run"]} | {t["elapsedMs"]/1000:.2f} / {t["totalJobMs"]/1000:.2f} | {r["warmMedianMs"]/1000:.2f} / {r["warmMedianTotalJobMs"]/1000:.2f} | {q["ordinaryWer"]:.2%} | {q["retainedUhUm"]}/14 | {q["insertedUhUm"]} | {r["peakRamBytes"]/1048576:.1f} |')
lines += ["", "Selected: large-v3-turbo-q5_0, CUDA, four threads, initial prompt `Umm, so, uh, I think, like, you know.`. All four selected-profile trials produced 3/194 verbatim word errors, 13/14 retained UH/UM, and zero inserted UH/UM. CPU base is an explicit smaller alternative, never an automatic fallback.", "",
    "This small public sample does not establish personal accuracy or verified word alignment. Ambiguous ‘like’ and ‘you know’ are excluded from filler counts. All detected fillers require review. Out-of-range segment timing remains unavailable rather than clamped. Per-process VRAM is unavailable with a reason. The older slow JFK GPU result was not reproduced; its cause remains unknown. Some CPU filler trials overlapped development checks.", "",
    "CrisperWhisper is deferred: its custom adapter and noncommercial model licence need separate evaluation. No additional model download is required for the selected profile. Packaging and redistribution review remain M6 work.", ""]
(ROOT / "results-2026-10.md").write_text("\n".join(lines), encoding="utf-8")
