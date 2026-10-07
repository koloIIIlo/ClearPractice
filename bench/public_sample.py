"""Portable M0 public fixture preparation/scoring; Python standard library only.

Audio and verbatim references stay under ignored samples/. The reference comes
from the dataset, never a candidate model. No audio is uploaded by this script.
"""
import argparse
import hashlib
import json
import re
import unittest
import wave
from pathlib import Path


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prepare(folder):
    folder = Path(folder)
    source = read(folder / "public-reference-source.json")
    output = folder / "public-62s.wav"
    reference = folder / "public-62s-reference.json"
    if output.exists() or reference.exists():
        raise ValueError("Use fresh output files; existing benchmark inputs are preserved.")
    pcm, clips, frames = [], [], 0
    for clip in source["clips"]:
        path = folder / clip["file"]
        if path.parent != folder or digest(path) != clip["sha256"]:
            raise ValueError("Source path/checksum mismatch")
        with wave.open(str(path), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, 16000, "NONE"):
                raise ValueError("Source must already be 16 kHz mono PCM16; do not silently alter it")
            count = wav.getnframes()
            data = wav.readframes(count)
            if len(data) != count * 2:
                raise ValueError("Truncated source")
        pcm.append(data)
        clips.append({**clip, "startMs": frames / 16, "endMs": (frames + count) / 16,
                      "timingProvenance": "Estimated", "timingReason": "Clip boundaries only; no reference word alignment"})
        frames += count
    with wave.open(str(output), "wb") as wav:
        wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        wav.writeframes(b"".join(pcm))
    reference.write_text(json.dumps({**source, "version": 1, "clips": clips, "sha256": digest(output),
        "durationMs": frames / 16, "composition": "Complete clips concatenated without trimming or added silence; not one continuous speaker",
        "verbatim": " ".join(c["verbatim"] for c in clips)}, indent=2) + "\n", encoding="utf-8")
    print(f"Prepared {frames / 16000:.3f}s; SHA256 {digest(output)}")


def tokens(text):
    # UH/UM labels are explicit reference fillers. Other bracketed labels denote
    # sounds (e.g. laughter), not lexical words. Restarts/repetitions are retained.
    text = re.sub(r"\[(UH|UM)\]", lambda m: m[1].lower(), text, flags=re.I)
    text = re.sub(r"\[[^]]*\]", " ", text)
    words = re.findall(r"[a-z]+(?:'[a-z]+)?", text.lower().replace("’", "'"))
    return ["uh" if re.fullmatch(r"u+h+", w) else "um" if re.fullmatch(r"u+m+", w) else w for w in words]


def align(reference, predicted):
    # Full Levenshtein alignment; ties prefer matching/substituting the current
    # word. Deterministic but repeated fillers can have ambiguous locations.
    grid = [[0] * (len(predicted) + 1) for _ in range(len(reference) + 1)]
    for i in range(len(reference) + 1):
        grid[i][0] = i
    for j in range(len(predicted) + 1):
        grid[0][j] = j
    for i, word in enumerate(reference, 1):
        for j, other in enumerate(predicted, 1):
            grid[i][j] = min(grid[i-1][j-1] + (word != other), grid[i-1][j] + 1, grid[i][j-1] + 1)
    i, j, pairs = len(reference), len(predicted), []
    while i or j:
        if i and j and grid[i][j] == grid[i-1][j-1] + (reference[i-1] != predicted[j-1]):
            pairs.append((reference[i-1], predicted[j-1]))
            i, j = i-1, j-1
        elif i and grid[i][j] == grid[i-1][j] + 1:
            pairs.append((reference[i-1], None))
            i -= 1
        else:
            pairs.append((None, predicted[j-1]))
            j -= 1
    return grid[-1][-1], list(reversed(pairs))


def metrics(reference, predicted):
    ref, hyp = tokens(reference), tokens(predicted)
    errors, pairs = align(ref, hyp)
    fillers = {"uh", "um"}
    expected = sum(w in fillers for w in ref)
    retained = sum(a in fillers and a == b for a, b in pairs)
    inserted = sum(b in fillers and b != a for a, b in pairs)
    ordinary_ref = [w for w in ref if w not in fillers]
    ordinary_errors, _ = align(ordinary_ref, [w for w in hyp if w not in fillers])
    return {"provenance": "Measured", "referenceWords": len(ref), "verbatimWordErrors": errors,
        "verbatimWer": errors / len(ref) if ref else None,
        "ordinaryWer": ordinary_errors / len(ordinary_ref) if ordinary_ref else None,
        "referenceUhUm": expected, "retainedUhUm": retained, "insertedUhUm": inserted,
        "fillerRecall": retained / expected if expected else None,
        "fillerUnavailableReason": None if expected else "Reference contains no UH/UM labels",
        "scope": "Explicit UH/UM only; like/you know are ambiguous and excluded from filler counts",
        "alignmentLimit": "Word edit alignment without reference word timestamps; repeated fillers can be ambiguous"}


def score(reference_path, run_dir):
    reference, folder = read(reference_path), Path(run_dir)
    report = read(folder / "benchmark.json")
    if digest(folder / "recordings/benchmark/audio.wav") != report["sourceSha256"]:
        raise ValueError("Benchmark original differs from its report")
    # Canonical WAV metadata can differ. Verify exact PCM against prepared
    # reference, not merely duration or a text associated with a different take.
    source_wav = Path(reference_path).with_name("public-62s.wav")
    if digest(source_wav) != reference["sha256"]:
        raise ValueError("Reference source changed")
    with wave.open(str(source_wav), "rb") as a, wave.open(str(folder / "recordings/benchmark/audio.wav"), "rb") as b:
        if a.getparams() != b.getparams() or a.readframes(a.getnframes()) != b.readframes(b.getnframes()):
            raise ValueError("Reference and benchmark PCM do not match")
    trials = []
    for trial in report["trials"]:
        result = read(folder / "cache/whisper" / trial["runId"] / "result.json")
        if result["sourceSha256"] != report["sourceSha256"]:
            raise ValueError("Transcript source mismatch")
        trials.append({"runId": trial["runId"], **metrics(reference["verbatim"], result["rawText"])})
    output = {"version": 1, "dataset": reference["dataset"], "source": reference["source"],
              "license": reference["license"], "sourceSha256": report["sourceSha256"],
              "durationMs": reference["durationMs"], "trials": trials,
              "personalAccuracy": None, "personalAccuracyUnavailableReason": "Public multi-clip fixture substituted at user's request"}
    (folder / "quality.json").write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(trials[0], indent=2))


class ScoringTests(unittest.TestCase):
    def test_filler_deletion_and_false_insertion(self):
        result = metrics("I [UH] think [UM] so", "I think um so uh")
        self.assertEqual((result["retainedUhUm"], result["insertedUhUm"], result["fillerRecall"]), (1, 1, .5))
        self.assertEqual(result["ordinaryWer"], 0)

    def test_restarts_are_not_cleaned_and_like_is_not_automatically_a_filler(self):
        self.assertEqual(tokens("[laughter] I I bam* like umm uh"), ["i", "i", "bam", "like", "um", "uh"])
        self.assertEqual(metrics("I I think", "I think")["verbatimWordErrors"], 1)
        self.assertIsNone(metrics("I like it", "I like it")["fillerRecall"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "score", "test"])
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args()
    if args.action == "test":
        unittest.main(argv=[__file__])
    elif args.action == "prepare":
        prepare(*args.paths)
    else:
        score(*args.paths)
