from __future__ import annotations

import argparse
import csv
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Sample:
    genuine: bool
    score: float
    cohort: str


def read_samples(path: Path) -> list[Sample]:
    samples: list[Sample] = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            label = (row.get("label") or "").strip().lower()
            if label not in {"genuine", "impostor"}:
                raise ValueError("label debe ser genuine o impostor")
            score = float(row.get("score") or "nan")
            if not 0 <= score <= 1:
                raise ValueError("score debe estar entre 0 y 1")
            samples.append(Sample(label == "genuine", score, (row.get("cohort") or "all").strip() or "all"))
    if not any(sample.genuine for sample in samples) or not any(not sample.genuine for sample in samples):
        raise ValueError("Se requieren pares genuine e impostor")
    return samples


def metrics(samples: list[Sample], threshold: float) -> dict[str, float | int]:
    genuine = [sample for sample in samples if sample.genuine]
    impostor = [sample for sample in samples if not sample.genuine]
    false_rejects = sum(sample.score < threshold for sample in genuine)
    false_accepts = sum(sample.score >= threshold for sample in impostor)
    return {
        "genuine": len(genuine),
        "impostor": len(impostor),
        "falseRejectRate": false_rejects / len(genuine),
        "falseAcceptRate": false_accepts / len(impostor),
    }


def select_threshold(samples: list[Sample], max_false_accept_rate: float) -> tuple[float, dict[str, float | int]]:
    candidates = sorted({0.0, 1.0, *(sample.score for sample in samples)})
    eligible = [(threshold, metrics(samples, threshold)) for threshold in candidates]
    eligible = [item for item in eligible if float(item[1]["falseAcceptRate"]) <= max_false_accept_rate]
    if not eligible:
        raise ValueError("Ningun umbral cumple el FAR solicitado")
    return min(eligible, key=lambda item: (float(item[1]["falseRejectRate"]), item[0]))


def main() -> None:
    parser = argparse.ArgumentParser(description="Sugiere un umbral; no modifica configuracion productiva")
    parser.add_argument("csv", type=Path, help="Columnas: label,score y opcional cohort")
    parser.add_argument("--max-far", type=float, default=0.001)
    args = parser.parse_args()
    if not 0 <= args.max_far <= 1:
        raise SystemExit("--max-far debe estar entre 0 y 1")
    samples = read_samples(args.csv)
    threshold, overall = select_threshold(samples, args.max_far)
    cohorts: dict[str, list[Sample]] = defaultdict(list)
    for sample in samples:
        cohorts[sample.cohort].append(sample)
    result = {
        "suggestedThreshold": threshold,
        "targetMaxFalseAcceptRate": args.max_far,
        "overall": overall,
        "cohorts": {
            name: metrics(items, threshold)
            for name, items in sorted(cohorts.items())
            if any(item.genuine for item in items) and any(not item.genuine for item in items)
        },
        "warning": "Valide con poblacion, camaras y condiciones reales antes de cambiar FACE_MATCH_THRESHOLD.",
    }
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
