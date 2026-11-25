from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _required(name: str, env: dict[str, str]) -> str:
    value = env.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} es requerido")
    return value


def _integer(name: str, default: int, minimum: int, maximum: int, env: dict[str, str]) -> int:
    raw = env.get(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} debe ser entero") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{name} debe estar entre {minimum} y {maximum}")
    return value


def _number(name: str, default: float, minimum: float, maximum: float, env: dict[str, str]) -> float:
    raw = env.get(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} debe ser numerico") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{name} debe estar entre {minimum} y {maximum}")
    return value


def _hex_key(name: str, env: dict[str, str]) -> bytes:
    raw = _required(name, env)
    if len(raw) != 64:
        raise ValueError(f"{name} debe contener exactamente 64 caracteres hexadecimales")
    try:
        return bytes.fromhex(raw)
    except ValueError as exc:
        raise ValueError(f"{name} debe ser hexadecimal") from exc


@dataclass(frozen=True, slots=True)
class Settings:
    environment: str
    auth_tokens: tuple[str, ...]
    template_encryption_key: bytes
    identifier_hash_key: bytes
    database_url: str
    models_dir: Path
    model_name: str
    max_request_bytes: int
    max_frame_bytes: int
    max_concurrency: int
    queue_timeout_seconds: float
    max_frames: int
    min_liveness_frames: int
    match_threshold: float
    passive_liveness_threshold: float
    passive_liveness_majority: float
    min_blur_variance: float
    min_brightness: float
    max_brightness: float
    min_face_ratio: float
    max_face_ratio: float
    active_motion_threshold: float
    cross_frame_match_threshold: float
    purge_interval_seconds: int

    @classmethod
    def from_env(cls, source: dict[str, str] | None = None) -> "Settings":
        env = dict(os.environ if source is None else source)
        environment = env.get("FACE_ENV", "production").strip().lower()
        if environment not in {"development", "test", "production"}:
            raise ValueError("FACE_ENV debe ser development, test o production")
        auth_tokens = tuple(token.strip() for token in _required("FACE_AUTH_TOKENS", env).split(",") if token.strip())
        if not auth_tokens or any(len(token) < 32 for token in auth_tokens):
            raise ValueError("Cada token en FACE_AUTH_TOKENS debe tener al menos 32 caracteres")
        encryption_key = _hex_key("FACE_TEMPLATE_ENCRYPTION_KEY", env)
        identifier_key = _hex_key("FACE_IDENTIFIER_HASH_KEY", env)
        if encryption_key == identifier_key:
            raise ValueError("Las claves de cifrado e identificadores deben ser diferentes")
        min_brightness = _number("FACE_MIN_BRIGHTNESS", 45, 0, 254, env)
        max_brightness = _number("FACE_MAX_BRIGHTNESS", 215, 1, 255, env)
        min_face_ratio = _number("FACE_MIN_FACE_RATIO", 0.12, 0.05, 0.8, env)
        max_face_ratio = _number("FACE_MAX_FACE_RATIO", 0.78, 0.1, 0.95, env)
        if min_brightness >= max_brightness:
            raise ValueError("FACE_MIN_BRIGHTNESS debe ser menor que FACE_MAX_BRIGHTNESS")
        if min_face_ratio >= max_face_ratio:
            raise ValueError("FACE_MIN_FACE_RATIO debe ser menor que FACE_MAX_FACE_RATIO")
        max_frames = _integer("FACE_MAX_FRAMES", 6, 3, 8, env)
        min_liveness_frames = _integer("FACE_MIN_LIVENESS_FRAMES", 4, 3, max_frames, env)
        database_url = env.get("FACE_DATABASE_URL", "sqlite:///./data/biometric-templates.db").strip()
        if environment == "production" and database_url.startswith("sqlite:"):
            raise ValueError("FACE_DATABASE_URL debe usar MySQL o PostgreSQL en produccion multi-replica")
        return cls(
            environment=environment,
            auth_tokens=auth_tokens,
            template_encryption_key=encryption_key,
            identifier_hash_key=identifier_key,
            database_url=database_url,
            models_dir=Path(env.get("FACE_MODELS_DIR", "./models")).resolve(),
            model_name=env.get("FACE_MODEL_NAME", "yunet-sface-minifas-v1").strip(),
            max_request_bytes=_integer("FACE_MAX_REQUEST_BYTES", 18_000_000, 1_000_000, 30_000_000, env),
            max_frame_bytes=_integer("FACE_MAX_FRAME_BYTES", 2_097_152, 100_000, 5_000_000, env),
            max_concurrency=_integer("FACE_MAX_CONCURRENCY", 1, 1, 32, env),
            queue_timeout_seconds=_number("FACE_QUEUE_TIMEOUT_SECONDS", 0.5, 0.05, 5.0, env),
            max_frames=max_frames,
            min_liveness_frames=min_liveness_frames,
            match_threshold=_number("FACE_MATCH_THRESHOLD", 0.45, 0.1, 0.99, env),
            passive_liveness_threshold=_number("FACE_PASSIVE_LIVENESS_THRESHOLD", 0.80, 0.5, 0.999, env),
            passive_liveness_majority=_number("FACE_PASSIVE_LIVENESS_MAJORITY", 0.60, 0.5, 1.0, env),
            min_blur_variance=_number("FACE_MIN_BLUR_VARIANCE", 55, 1, 1000, env),
            min_brightness=min_brightness,
            max_brightness=max_brightness,
            min_face_ratio=min_face_ratio,
            max_face_ratio=max_face_ratio,
            active_motion_threshold=_number("FACE_ACTIVE_MOTION_THRESHOLD", 0.025, 0.005, 0.3, env),
            cross_frame_match_threshold=_number("FACE_CROSS_FRAME_MATCH_THRESHOLD", 0.50, 0.1, 0.99, env),
            purge_interval_seconds=_integer("FACE_PURGE_INTERVAL_SECONDS", 3600, 60, 86_400, env),
        )
