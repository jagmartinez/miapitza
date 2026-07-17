from __future__ import annotations

import base64
import binascii
import hashlib
import math
import threading
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

from .config import Settings
from .errors import BiometricError
from .schemas import CaptureFrame


MODEL_FILES = {
    "detector": "face_detection_yunet_2023mar.onnx",
    "recognizer": "face_recognition_sface_2021dec.onnx",
    "antispoof": "minifas_v2_se_quantized.onnx",
}

MODEL_SHA256 = {
    "detector": "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    "recognizer": "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    "antispoof": "fde20585635cae62ed1d41796f76b6f8bc4b92cd91ec1cf0f1bc6485d2d587a9",
}


@dataclass(slots=True)
class FrameAnalysis:
    embedding: np.ndarray
    passive_score: float
    nose_offset: float
    blur: float
    brightness: float


@dataclass(slots=True)
class EvidenceAnalysis:
    embedding: np.ndarray
    liveness_passed: bool
    passive_score: float
    active_motion: float


class FaceEngine:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self._detector: cv2.FaceDetectorYN | None = None
        self._recognizer: cv2.FaceRecognizerSF | None = None
        self._antispoof: ort.InferenceSession | None = None
        self._antispoof_input = ""

    def initialize(self) -> None:
        paths = {name: self.settings.models_dir / filename for name, filename in MODEL_FILES.items()}
        for name, path in paths.items():
            if not path.is_file():
                raise RuntimeError(f"Modelo ausente: {path}")
            actual = hashlib.sha256(path.read_bytes()).hexdigest()
            if actual != MODEL_SHA256[name]:
                raise RuntimeError(f"Hash invalido para {path.name}")
        self._detector = cv2.FaceDetectorYN.create(str(paths["detector"]), "", (320, 320), 0.9, 0.3, 5000)
        self._recognizer = cv2.FaceRecognizerSF.create(str(paths["recognizer"]), "")
        self._antispoof = ort.InferenceSession(str(paths["antispoof"]), providers=["CPUExecutionProvider"])
        self._antispoof_input = self._antispoof.get_inputs()[0].name

    def _decode(self, capture: CaptureFrame) -> np.ndarray:
        try:
            raw = base64.b64decode(capture.content_base64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise BiometricError("CAPTURE_INVALID", "La captura no es base64 valido") from exc
        if not raw or len(raw) > self.settings.max_frame_bytes:
            raise BiometricError("CAPTURE_SIZE_INVALID", "La captura esta vacia o excede el limite", status_code=413)
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.ndim != 3:
            raise BiometricError("CAPTURE_INVALID", "La captura no es una imagen valida")
        height, width = image.shape[:2]
        if min(width, height) < 320 or max(width, height) > 2048:
            raise BiometricError("CAPTURE_DIMENSIONS_INVALID", "La imagen debe medir entre 320 y 2048 pixeles")
        return image

    @staticmethod
    def _crop_face(image: np.ndarray, face: np.ndarray, expansion: float = 1.5) -> np.ndarray:
        x, y, width, height = (float(value) for value in face[:4])
        side = max(width, height) * expansion
        center_x, center_y = x + width / 2, y + height / 2
        left, top = int(round(center_x - side / 2)), int(round(center_y - side / 2))
        right, bottom = int(round(center_x + side / 2)), int(round(center_y + side / 2))
        pad_left, pad_top = max(0, -left), max(0, -top)
        pad_right, pad_bottom = max(0, right - image.shape[1]), max(0, bottom - image.shape[0])
        if any((pad_left, pad_top, pad_right, pad_bottom)):
            image = cv2.copyMakeBorder(image, pad_top, pad_bottom, pad_left, pad_right, cv2.BORDER_REFLECT_101)
            left, right = left + pad_left, right + pad_left
            top, bottom = top + pad_top, bottom + pad_top
        return image[max(0, top) : max(0, bottom), max(0, left) : max(0, right)]

    def _passive_score(self, image: np.ndarray, face: np.ndarray) -> float:
        assert self._antispoof is not None
        crop = self._crop_face(image, face)
        if crop.size == 0:
            raise BiometricError("FACE_CROP_INVALID", "No fue posible aislar el rostro")
        rgb = cv2.cvtColor(cv2.resize(crop, (128, 128), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB)
        tensor = np.transpose(rgb.astype(np.float32) / 255.0, (2, 0, 1))[None, ...]
        logits = np.asarray(self._antispoof.run(None, {self._antispoof_input: tensor})[0]).reshape(-1)
        if logits.size < 2 or not np.all(np.isfinite(logits[:2])):
            raise BiometricError("LIVENESS_MODEL_ERROR", "El modelo de vida devolvio un resultado invalido", status_code=503)
        shifted = logits[:2] - np.max(logits[:2])
        probabilities = np.exp(shifted) / np.sum(np.exp(shifted))
        return float(probabilities[0])

    @staticmethod
    def _normalize(vector: np.ndarray) -> np.ndarray:
        flat = np.asarray(vector, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(flat))
        if not math.isfinite(norm) or norm <= 1e-8:
            raise BiometricError("EMBEDDING_INVALID", "El modelo facial devolvio una plantilla invalida", status_code=503)
        return flat / norm

    def _analyze_frame(self, image: np.ndarray) -> FrameAnalysis:
        assert self._detector is not None and self._recognizer is not None
        height, width = image.shape[:2]
        self._detector.setInputSize((width, height))
        _, faces = self._detector.detect(image)
        count = 0 if faces is None else len(faces)
        if count == 0:
            raise BiometricError("FACE_NOT_FOUND", "No se detecto un rostro completo")
        if count != 1:
            raise BiometricError("MULTIPLE_FACES", "Debe aparecer exactamente una persona", retryable=True)
        face = np.asarray(faces[0], dtype=np.float32)
        x, y, face_width, face_height = (float(value) for value in face[:4])
        face_ratio = (face_width * face_height) / float(width * height)
        if face_ratio < self.settings.min_face_ratio:
            raise BiometricError("FACE_TOO_SMALL", "Acerca el rostro a la camara")
        if face_ratio > self.settings.max_face_ratio:
            raise BiometricError("FACE_TOO_CLOSE", "Aleja un poco el rostro de la camara")
        crop = self._crop_face(image, face, expansion=1.05)
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        brightness = float(np.mean(gray))
        if blur < self.settings.min_blur_variance:
            raise BiometricError("CAPTURE_BLURRY", "La captura esta borrosa; mantente quieto")
        if brightness < self.settings.min_brightness:
            raise BiometricError("CAPTURE_TOO_DARK", "Busca una iluminacion frontal mas clara")
        if brightness > self.settings.max_brightness:
            raise BiometricError("CAPTURE_TOO_BRIGHT", "Reduce la luz directa sobre el rostro")
        aligned = self._recognizer.alignCrop(image, face)
        embedding = self._normalize(self._recognizer.feature(aligned))
        right_eye_x, left_eye_x, nose_x = float(face[4]), float(face[6]), float(face[8])
        eye_midpoint = (right_eye_x + left_eye_x) / 2
        nose_offset = (nose_x - eye_midpoint) / max(face_width, 1.0)
        return FrameAnalysis(
            embedding=embedding,
            passive_score=self._passive_score(image, face),
            nose_offset=nose_offset,
            blur=blur,
            brightness=brightness,
        )

    def analyze(self, captures: list[CaptureFrame], liveness_action: str, require_liveness: bool) -> EvidenceAnalysis:
        if len(captures) > self.settings.max_frames:
            raise BiometricError("TOO_MANY_FRAMES", "La evidencia contiene demasiados cuadros", status_code=413)
        required = self.settings.min_liveness_frames if require_liveness else 1
        if len(captures) < required:
            raise BiometricError("INSUFFICIENT_FRAMES", "La prueba de vida requiere una secuencia completa")
        with self._lock:
            analyses = [self._analyze_frame(self._decode(capture)) for capture in captures]
        reference = analyses[0].embedding
        cross_scores = [float(np.dot(reference, item.embedding)) for item in analyses[1:]]
        if cross_scores and min(cross_scores) < self.settings.cross_frame_match_threshold:
            raise BiometricError("IDENTITY_CHANGED_DURING_CAPTURE", "El rostro cambio durante la secuencia", retryable=False)
        passive_scores = [item.passive_score for item in analyses]
        passive_passes = sum(score >= self.settings.passive_liveness_threshold for score in passive_scores)
        passive_ratio = passive_passes / len(passive_scores)
        passive_passed = passive_ratio >= self.settings.passive_liveness_majority
        initial_offset = analyses[0].nose_offset
        expected_sign = 1.0 if liveness_action == "TURN_LEFT" else -1.0
        signed_deltas = [expected_sign * (item.nose_offset - initial_offset) for item in analyses[1:]]
        active_motion = max(signed_deltas, default=0.0)
        active_passed = abs(initial_offset) <= 0.14 and active_motion >= self.settings.active_motion_threshold
        liveness_passed = passive_passed and (active_passed if require_liveness else True)
        if require_liveness and not passive_passed:
            raise BiometricError("PASSIVE_LIVENESS_FAILED", "La captura parece una foto, pantalla o reproduccion")
        if require_liveness and not active_passed:
            raise BiometricError("ACTIVE_LIVENESS_FAILED", "No se detecto el giro solicitado desde una posicion frontal")
        aggregate = self._normalize(np.mean(np.stack([item.embedding for item in analyses], axis=0), axis=0))
        return EvidenceAnalysis(
            embedding=aggregate,
            liveness_passed=liveness_passed,
            passive_score=float(np.mean(passive_scores)),
            active_motion=active_motion,
        )


def assert_model_files(models_dir: Path) -> None:
    for name, filename in MODEL_FILES.items():
        path = models_dir / filename
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != MODEL_SHA256[name]:
            raise RuntimeError(f"Modelo biometrico ausente o corrupto: {filename}")
