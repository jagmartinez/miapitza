from __future__ import annotations

import base64
from pathlib import Path

import cv2
import numpy as np
import pytest

from app.config import Settings
from app.engine import FaceEngine, FrameAnalysis, assert_model_files
from app.errors import BiometricError
from app.schemas import CaptureFrame


def settings(models_dir: Path) -> Settings:
    return Settings.from_env(
        {
            "FACE_ENV": "test",
            "FACE_AUTH_TOKENS": "test-token-with-at-least-thirty-two-characters",
            "FACE_TEMPLATE_ENCRYPTION_KEY": "11" * 32,
            "FACE_IDENTIFIER_HASH_KEY": "22" * 32,
            "FACE_MODELS_DIR": str(models_dir),
        }
    )


def frame(value: bytes = b"x" * 100) -> CaptureFrame:
    return CaptureFrame(contentBase64=base64.b64encode(value).decode(), mimeType="image/jpeg")


def analysis(embedding: list[float], passive: float, offset: float) -> FrameAnalysis:
    return FrameAnalysis(
        embedding=np.asarray(embedding, dtype=np.float32),
        passive_score=passive,
        nose_offset=offset,
        blur=100,
        brightness=120,
    )


def test_real_model_artifacts_initialize() -> None:
    models_dir = Path("/app/models")
    assert_model_files(models_dir)
    engine = FaceEngine(settings(models_dir))
    engine.initialize()


def test_decode_rejects_invalid_data_and_accepts_image(tmp_path: Path) -> None:
    engine = FaceEngine(settings(tmp_path))
    with pytest.raises(BiometricError, match="base64"):
        engine._decode(CaptureFrame(contentBase64="!" * 100, mimeType="image/jpeg"))
    with pytest.raises(BiometricError, match="imagen valida"):
        engine._decode(frame())
    tiny = np.full((100, 100, 3), 120, dtype=np.uint8)
    encoded_tiny = cv2.imencode(".jpg", tiny)[1].tobytes()
    with pytest.raises(BiometricError, match="320"):
        engine._decode(frame(encoded_tiny))
    valid = np.full((640, 640, 3), 120, dtype=np.uint8)
    encoded = cv2.imencode(".jpg", valid)[1].tobytes()
    assert engine._decode(frame(encoded)).shape == (640, 640, 3)


def test_crop_and_normalization_guards(tmp_path: Path) -> None:
    engine = FaceEngine(settings(tmp_path))
    image = np.full((50, 50, 3), 120, dtype=np.uint8)
    cropped = engine._crop_face(image, np.asarray([-10, -10, 30, 30], dtype=np.float32))
    assert cropped.size > 0
    assert np.allclose(engine._normalize(np.asarray([3.0, 4.0], dtype=np.float32)), [0.6, 0.8])
    with pytest.raises(BiometricError, match="plantilla invalida"):
        engine._normalize(np.zeros(2, dtype=np.float32))


class FakeDetector:
    def __init__(self, faces: np.ndarray | None) -> None:
        self.faces = faces

    def setInputSize(self, _size: tuple[int, int]) -> None:
        return None

    def detect(self, _image: np.ndarray) -> tuple[None, np.ndarray | None]:
        return None, self.faces


class FakeRecognizer:
    def alignCrop(self, image: np.ndarray, _face: np.ndarray) -> np.ndarray:
        return image[:112, :112]

    def feature(self, _aligned: np.ndarray) -> np.ndarray:
        return np.asarray([[1.0, 0.0, 0.0]], dtype=np.float32)


class FakeAntiSpoof:
    def run(self, _outputs: None, _inputs: dict[str, np.ndarray]) -> list[np.ndarray]:
        return [np.asarray([[8.0, -2.0]], dtype=np.float32)]


def face_row() -> np.ndarray:
    return np.asarray(
        [[170, 170, 300, 300, 260, 280, 380, 280, 320, 340, 275, 410, 365, 410, 0.99]],
        dtype=np.float32,
    )


def test_frame_analysis_requires_exactly_one_quality_face(tmp_path: Path) -> None:
    engine = FaceEngine(settings(tmp_path))
    engine._recognizer = FakeRecognizer()  # type: ignore[assignment]
    engine._antispoof = FakeAntiSpoof()  # type: ignore[assignment]
    engine._antispoof_input = "input"
    rng = np.random.default_rng(7)
    image = rng.integers(70, 180, size=(640, 640, 3), dtype=np.uint8)

    engine._detector = FakeDetector(None)  # type: ignore[assignment]
    with pytest.raises(BiometricError, match="No se detecto"):
        engine._analyze_frame(image)
    engine._detector = FakeDetector(np.concatenate([face_row(), face_row()]))  # type: ignore[assignment]
    with pytest.raises(BiometricError, match="exactamente una"):
        engine._analyze_frame(image)
    engine._detector = FakeDetector(face_row())  # type: ignore[assignment]
    result = engine._analyze_frame(image)
    assert result.embedding.tolist() == [1.0, 0.0, 0.0]
    assert result.passive_score > 0.99
    assert abs(result.nose_offset) < 0.01


def prepare_analyze(engine: FaceEngine, monkeypatch: pytest.MonkeyPatch, analyses: list[FrameAnalysis]) -> None:
    monkeypatch.setattr(engine, "_decode", lambda _capture: np.zeros((640, 640, 3), dtype=np.uint8))
    iterator = iter(analyses)
    monkeypatch.setattr(engine, "_analyze_frame", lambda _image: next(iterator))


def test_sequence_accepts_consistent_live_requested_motion(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    engine = FaceEngine(settings(tmp_path))
    prepare_analyze(
        engine,
        monkeypatch,
        [
            analysis([1, 0], 0.99, 0.00),
            analysis([1, 0], 0.99, 0.01),
            analysis([1, 0], 0.99, 0.04),
            analysis([1, 0], 0.99, 0.08),
        ],
    )
    result = engine.analyze([frame()] * 4, "TURN_LEFT", True)
    assert result.liveness_passed is True
    assert result.active_motion == pytest.approx(0.08)


@pytest.mark.parametrize(
    ("analyses", "message"),
    [
        ([analysis([1, 0], 0.1, 0.0)] * 4, "foto, pantalla"),
        (
            [
                analysis([1, 0], 0.99, 0.0),
                analysis([1, 0], 0.99, -0.01),
                analysis([1, 0], 0.99, -0.04),
                analysis([1, 0], 0.99, -0.08),
            ],
            "giro solicitado",
        ),
        (
            [
                analysis([1, 0], 0.99, 0.0),
                analysis([0, 1], 0.99, 0.04),
                analysis([1, 0], 0.99, 0.06),
                analysis([1, 0], 0.99, 0.08),
            ],
            "rostro cambio",
        ),
    ],
)
def test_sequence_rejects_spoof_wrong_motion_and_identity_swap(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    analyses: list[FrameAnalysis],
    message: str,
) -> None:
    engine = FaceEngine(settings(tmp_path))
    prepare_analyze(engine, monkeypatch, analyses)
    with pytest.raises(BiometricError, match=message):
        engine.analyze([frame()] * 4, "TURN_LEFT", True)


def test_sequence_enforces_frame_bounds(tmp_path: Path) -> None:
    engine = FaceEngine(settings(tmp_path))
    with pytest.raises(BiometricError, match="secuencia completa"):
        engine.analyze([frame()] * 3, "TURN_LEFT", True)
    with pytest.raises(BiometricError, match="demasiados"):
        engine.analyze([frame()] * 7, "TURN_LEFT", True)
