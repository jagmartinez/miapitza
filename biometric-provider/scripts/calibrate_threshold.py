from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
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


def evaluate_calibration_gate(
    samples: list[Sample],
    threshold: float,
    *,
    max_false_accept_rate: float,
    max_false_reject_rate: float,
    min_genuine: int,
    min_impostor: int,
    min_cohort_genuine: int,
    min_cohort_impostor: int,
) -> list[str]:
    failures: list[str] = []

    def evaluate_scope(name: str, scoped: list[Sample], required_genuine: int, required_impostor: int) -> None:
        genuine = sum(sample.genuine for sample in scoped)
        impostor = len(scoped) - genuine
        if genuine < required_genuine:
            failures.append(f"{name}: muestras genuine {genuine} < {required_genuine}")
        if impostor < required_impostor:
            failures.append(f"{name}: muestras impostor {impostor} < {required_impostor}")
        if genuine == 0 or impostor == 0:
            return
        result = metrics(scoped, threshold)
        if float(result["falseAcceptRate"]) > max_false_accept_rate:
            failures.append(f"{name}: FAR {result['falseAcceptRate']:.8f} > {max_false_accept_rate:.8f}")
        if float(result["falseRejectRate"]) > max_false_reject_rate:
            failures.append(f"{name}: FRR {result['falseRejectRate']:.8f} > {max_false_reject_rate:.8f}")

    evaluate_scope("overall", samples, min_genuine, min_impostor)
    cohorts: dict[str, list[Sample]] = defaultdict(list)
    for sample in samples:
        cohorts[sample.cohort].append(sample)
    for name, scoped in sorted(cohorts.items()):
        evaluate_scope(f"cohort:{name}", scoped, min_cohort_genuine, min_cohort_impostor)
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description="Sugiere un umbral; no modifica configuracion productiva")
    parser.add_argument("csv", type=Path, help="Columnas: label,score y opcional cohort")
    parser.add_argument("--max-far", type=float, default=0.001)
    parser.add_argument(
        "--threshold",
        type=float,
        help="Umbral desplegable que se evaluará; si se omite se usa el umbral sugerido",
    )
    parser.add_argument(
        "--gate", action="store_true", help="Falla si la calibracion no cumple todos los limites explicitos"
    )
    parser.add_argument("--max-frr", type=float)
    parser.add_argument("--min-genuine", type=int)
    parser.add_argument("--min-impostor", type=int)
    parser.add_argument("--min-cohort-genuine", type=int)
    parser.add_argument("--min-cohort-impostor", type=int)
    parser.add_argument("--out", type=Path, help="Escribe la evidencia JSON sin incluir capturas ni identificadores")
    args = parser.parse_args()
    if not 0 <= args.max_far <= 1:
        raise SystemExit("--max-far debe estar entre 0 y 1")
    if args.threshold is not None and not 0 <= args.threshold <= 1:
        raise SystemExit("--threshold debe estar entre 0 y 1")
    gate_values = {
        "--max-frr": args.max_frr,
        "--min-genuine": args.min_genuine,
        "--min-impostor": args.min_impostor,
        "--min-cohort-genuine": args.min_cohort_genuine,
        "--min-cohort-impostor": args.min_cohort_impostor,
    }
    if args.gate:
        missing = [name for name, value in gate_values.items() if value is None]
        if missing:
            raise SystemExit(f"--gate requiere valores explicitos: {', '.join(missing)}")
        if not 0 <= args.max_frr <= 1:
            raise SystemExit("--max-frr debe estar entre 0 y 1")
        for name in ("min_genuine", "min_impostor", "min_cohort_genuine", "min_cohort_impostor"):
            if getattr(args, name) < 1:
                raise SystemExit(f"--{name.replace('_', '-')} debe ser al menos 1")
    samples = read_samples(args.csv)
    suggested_threshold, suggested_metrics = select_threshold(samples, args.max_far)
    threshold = args.threshold if args.threshold is not None else suggested_threshold
    overall = metrics(samples, threshold)
    cohorts: dict[str, list[Sample]] = defaultdict(list)
    for sample in samples:
        cohorts[sample.cohort].append(sample)
    result: dict[str, object] = {
        "generatedAt": datetime.now(UTC).isoformat(),
        "datasetSha256": hashlib.sha256(args.csv.read_bytes()).hexdigest(),
        "suggestedThreshold": suggested_threshold,
        "suggestedThresholdMetrics": suggested_metrics,
        "evaluatedThreshold": threshold,
        "targetMaxFalseAcceptRate": args.max_far,
        "overall": overall,
        "cohorts": {
            name: metrics(items, threshold)
            for name, items in sorted(cohorts.items())
            if any(item.genuine for item in items) and any(not item.genuine for item in items)
        },
        "warning": "Valide con poblacion, camaras y condiciones reales antes de cambiar FACE_MATCH_THRESHOLD.",
    }
    exit_code = 0
    if args.gate:
        failures = evaluate_calibration_gate(
            samples,
            threshold,
            max_false_accept_rate=args.max_far,
            max_false_reject_rate=args.max_frr,
            min_genuine=args.min_genuine,
            min_impostor=args.min_impostor,
            min_cohort_genuine=args.min_cohort_genuine,
            min_cohort_impostor=args.min_cohort_impostor,
        )
        result["gate"] = {
            "passed": not failures,
            "requirements": {
                "maxFalseAcceptRate": args.max_far,
                "maxFalseRejectRate": args.max_frr,
                "minGenuine": args.min_genuine,
                "minImpostor": args.min_impostor,
                "minCohortGenuine": args.min_cohort_genuine,
                "minCohortImpostor": args.min_cohort_impostor,
            },
            "failures": failures,
        }
        exit_code = 0 if not failures else 2
    rendered = json.dumps(result, indent=2, sort_keys=True)
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(f"{rendered}\n", encoding="utf-8")
    print(rendered)
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
