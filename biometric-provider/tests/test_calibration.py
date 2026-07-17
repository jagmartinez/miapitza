from __future__ import annotations

from scripts.calibrate_threshold import Sample, metrics, select_threshold


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
