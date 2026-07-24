from __future__ import annotations

import json
import sys

import pytest

from scripts.calibrate_threshold import Sample, evaluate_calibration_gate, main, metrics, select_threshold


def test_threshold_respects_far_target_and_reports_false_rejects() -> None:
    samples = [
        Sample(True, 0.92, "phone-a"),
        Sample(True, 0.70, "phone-a"),
        Sample(True, 0.42, "phone-b"),
        Sample(False, 0.40, "phone-a"),
        Sample(False, 0.22, "phone-b"),
        Sample(False, 0.10, "phone-b"),
    ]
    threshold, result = select_threshold(samples, 0.0)
    assert threshold > 0.40
    assert result["falseAcceptRate"] == 0
    assert result["falseRejectRate"] == 0
    assert metrics(samples, 0.80)["falseRejectRate"] == 2 / 3


def test_calibration_gate_checks_overall_and_each_camera_cohort() -> None:
    samples = [
        Sample(True, 0.95, "camera-a"),
        Sample(True, 0.90, "camera-a"),
        Sample(False, 0.20, "camera-a"),
        Sample(False, 0.10, "camera-a"),
        Sample(True, 0.80, "camera-b"),
        Sample(False, 0.90, "camera-b"),
    ]
    failures = evaluate_calibration_gate(
        samples,
        0.85,
        max_false_accept_rate=0,
        max_false_reject_rate=0,
        min_genuine=3,
        min_impostor=3,
        min_cohort_genuine=2,
        min_cohort_impostor=2,
    )
    assert any("cohort:camera-b: muestras genuine 1 < 2" in failure for failure in failures)
    assert any("cohort:camera-b: muestras impostor 1 < 2" in failure for failure in failures)
    assert any("cohort:camera-b: FAR" in failure for failure in failures)
    assert any("cohort:camera-b: FRR" in failure for failure in failures)


def test_calibration_gate_passes_only_when_all_explicit_limits_hold() -> None:
    samples = [
        Sample(True, 0.95, "camera-a"),
        Sample(True, 0.90, "camera-a"),
        Sample(False, 0.20, "camera-a"),
        Sample(False, 0.10, "camera-a"),
        Sample(True, 0.92, "camera-b"),
        Sample(True, 0.87, "camera-b"),
        Sample(False, 0.30, "camera-b"),
        Sample(False, 0.15, "camera-b"),
    ]
    assert evaluate_calibration_gate(
        samples,
        0.85,
        max_false_accept_rate=0,
        max_false_reject_rate=0,
        min_genuine=4,
        min_impostor=4,
        min_cohort_genuine=2,
        min_cohort_impostor=2,
    ) == []


def test_cli_gate_writes_auditable_evidence_and_fails_closed(tmp_path, monkeypatch) -> None:
    dataset = tmp_path / "calibration.csv"
    evidence = tmp_path / "evidence.json"
    dataset.write_text(
        "label,score,cohort\n"
        "genuine,0.95,camera-a\n"
        "impostor,0.90,camera-a\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "calibrate_threshold.py",
            str(dataset),
            "--gate",
            "--max-far",
            "0",
            "--threshold",
            "0.85",
            "--max-frr",
            "0",
            "--min-genuine",
            "2",
            "--min-impostor",
            "2",
            "--min-cohort-genuine",
            "2",
            "--min-cohort-impostor",
            "2",
            "--out",
            str(evidence),
        ],
    )

    with pytest.raises(SystemExit) as exit_info:
        main()

    assert exit_info.value.code == 2
    payload = json.loads(evidence.read_text(encoding="utf-8"))
    assert payload["gate"]["passed"] is False
    assert payload["evaluatedThreshold"] == 0.85
    assert any("FAR" in failure for failure in payload["gate"]["failures"])
    assert len(payload["datasetSha256"]) == 64
    assert payload["generatedAt"].endswith("+00:00")
