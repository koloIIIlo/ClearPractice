"""Gate P: compare ClearPractice's YIN contour with Praat's autocorrelation
pitch (To Pitch (ac), 10 ms, 60-500 Hz) on the same recordings.

Usage: python bench/pitch_vs_praat.py <yin_csv_dir> <praat_csv_dir> <out_json>
Each folder holds <name>.csv with `time_s,f0_hz` (empty f0 = unvoiced).
Standard library only; reads files, sends nothing.
"""
import csv
import json
import math
import statistics
import sys
from pathlib import Path


def load(path):
    with open(path, encoding="utf-8") as f:
        return [(float(r["time_s"]), float(r["f0_hz"]) if r["f0_hz"] else None) for r in csv.DictReader(f)]


def compare(yin, praat):
    # Match each YIN frame to the Praat frame nearest in time (within 5 ms).
    praat_by_t = {round(t * 1000): f for t, f in praat}
    both, only_yin, only_praat, diffs, octave = 0, 0, 0, [], 0
    for t, f in yin:
        ms = round(t * 1000)
        near = [k for k in range(ms - 5, ms + 6) if k in praat_by_t]
        p = praat_by_t[min(near, key=lambda k: abs(k - ms))] if near else "missing"
        if p == "missing":
            continue
        if f and p:
            both += 1
            d = 12 * math.log2(f / p)
            diffs.append(abs(d))
            if abs(abs(d) - 12) < 2:  # an octave apart, give or take 2 semitones
                octave += 1
        elif f:
            only_yin += 1
        elif p:
            only_praat += 1
    return {
        "framesBothVoiced": both,
        "octaveErrors": octave,
        "octaveErrorRate": octave / both if both else None,
        "medianAbsDiffSemitones": round(statistics.median(diffs), 3) if diffs else None,
        "within1Semitone": round(sum(d <= 1 for d in diffs) / len(diffs), 4) if diffs else None,
        "voicedOnlyByYin": only_yin,
        "voicedOnlyByPraat": only_praat,
    }


def main(yin_dir, praat_dir, out):
    results = {}
    for path in sorted(Path(yin_dir).glob("*.csv")):
        other = Path(praat_dir) / path.name
        if other.exists():
            results[path.stem] = compare(load(path), load(other))
    total_both = sum(r["framesBothVoiced"] for r in results.values())
    summary = {
        "recordings": len(results),
        "framesBothVoiced": total_both,
        "octaveErrors": sum(r["octaveErrors"] for r in results.values()),
        "octaveErrorRate": sum(r["octaveErrors"] for r in results.values()) / total_both if total_both else None,
        "within1Semitone": round(sum(r["within1Semitone"] * r["framesBothVoiced"] for r in results.values() if r["within1Semitone"] is not None) / total_both, 4) if total_both else None,
        "voicedOnlyByYin": sum(r["voicedOnlyByYin"] for r in results.values()),
        "voicedOnlyByPraat": sum(r["voicedOnlyByPraat"] for r in results.values()),
        "reference": "Praat 7.0.02 To Pitch (ac): 0.01 s step, 60-500 Hz, default thresholds",
    }
    Path(out).write_text(json.dumps({"summary": summary, "recordings": results}, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))
    for name, r in results.items():
        print(f"{name}: both {r['framesBothVoiced']}, octave {r['octaveErrors']}, median {r['medianAbsDiffSemitones']} st, <=1 st {r['within1Semitone']}, only YIN {r['voicedOnlyByYin']}, only Praat {r['voicedOnlyByPraat']}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
