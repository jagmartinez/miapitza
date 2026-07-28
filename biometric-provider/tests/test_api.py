from __future__ import annotations

import base64
import threading
import time
from dataclasses import replace
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient
from sqlalchemy.exc import SQLAlchemyError

from app.config import Settings
from app.crypto import TemplateCipher
from app.engine import EvidenceAnalysis
from app.main import create_app
from app.storage import TemplateStore


class FakeEngine:
    def __init__(self, embeddings: list[np.ndarray]) -> None:
        self.embeddings = embeddings
        self.initialized = False

    def initialize(self) -> None:
        self.initialized = True

    def analyze(self, _captures: object, _action: str, _required: bool) -> EvidenceAnalysis:
        return EvidenceAnalysis(
            embedding=self.embeddings.pop(0),
            liveness_passed=True,
            passive_score=0.99,
            active_motion=0.1,
        )


class RecoveringRetentionStore:
    def __init__(self) -> None:
        self.purge_calls = 0
        self.retention_failed = threading.Event()
        self.allow_recovery = threading.Event()

    def initialize(self) -> None:
        return None

    def health_check(self) -> None:
        return None

    def purge_expired(self) -> int:
        self.purge_calls += 1
        if self.purge_calls == 1:
            return 0
        if self.purge_calls == 2:
            self.retention_failed.set()
            raise RuntimeError("simulated retention dependency failure")
        self.allow_recovery.wait(timeout=2)
        return 0


class InitiallyBlockedRetentionStore:
    def __init__(self) -> None:
        self.purge_started = threading.Event()
        self.allow_purge = threading.Event()

    def initialize(self) -> None:
        return None

    def health_check(self) -> None:
        return None

    def purge_expired(self) -> int:
        self.purge_started.set()
        self.allow_purge.wait(timeout=2)
        return 0


class UnavailableTemplateStore:
    def initialize(self) -> None:
        return None

    def health_check(self) -> None:
        raise SQLAlchemyError("simulated storage outage")

    def purge_expired(self) -> int:
        return 0

    def enroll(self, **_kwargs: object) -> str:
        raise SQLAlchemyError("simulated storage outage")


def settings(tmp_path: Path) -> Settings:
    return Settings.from_env(
        {
            "FACE_ENV": "test",
            "FACE_AUTH_TOKENS": "test-token-with-at-least-thirty-two-characters",
            "FACE_TEMPLATE_ENCRYPTION_KEY": "11" * 32,
            "FACE_IDENTIFIER_HASH_KEY": "22" * 32,
            "FACE_DATABASE_URL": f"sqlite:///{tmp_path / 'api.db'}",
            "FACE_MODELS_DIR": str(tmp_path),
        }
    )


def payload(challenge: str = "challenge-0001") -> dict[str, object]:
    capture = base64.b64encode(b"not-read-by-the-fake-engine" * 10).decode()
    return {
        "tenantRef": "tenant-a",
        "subjectRef": "user-1",
        "challengeRef": challenge,
        "livenessAction": "TURN_LEFT",
        "requireLiveness": True,
        "captures": [{"contentBase64": capture, "mimeType": "image/jpeg"}] * 4,
    }


def client(tmp_path: Path, embeddings: list[np.ndarray]) -> TestClient:
    current = settings(tmp_path)
    store = TemplateStore(
        current.database_url,
        TemplateCipher(current.template_encryption_key),
        current.identifier_hash_key,
    )
    app = create_app(current, engine=FakeEngine(embeddings), store=store)  # type: ignore[arg-type]
    return TestClient(app)


def auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token-with-at-least-thirty-two-characters"}


def wait_for_health(api: TestClient, expected_status: int = 200) -> None:
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if api.get("/health").status_code == expected_status:
            return
        time.sleep(0.01)
    assert api.get("/health").status_code == expected_status


def test_health_and_authentication(tmp_path: Path) -> None:
    with client(tmp_path, []) as api:
        wait_for_health(api)
        denied = api.post("/v1/enroll", json={})
        assert denied.status_code == 401
        assert denied.json()["code"] == "AUTH_REQUIRED"


def test_readiness_degrades_and_recovers_with_retention_worker(tmp_path: Path) -> None:
    current = replace(settings(tmp_path), purge_interval_seconds=0.05)
    store = RecoveringRetentionStore()
    app = create_app(current, engine=FakeEngine([]), store=store)  # type: ignore[arg-type]

    with TestClient(app) as api:
        wait_for_health(api)
        assert store.retention_failed.wait(timeout=2)

        degraded = api.get("/health")
        assert degraded.status_code == 503
        assert degraded.json()["code"] == "RETENTION_NOT_READY"
        assert "simulated" not in degraded.text

        store.allow_recovery.set()
        wait_for_health(api)


def test_readiness_stays_closed_until_first_retention_pass(tmp_path: Path) -> None:
    store = InitiallyBlockedRetentionStore()
    app = create_app(settings(tmp_path), engine=FakeEngine([]), store=store)  # type: ignore[arg-type]

    with TestClient(app) as api:
        assert store.purge_started.wait(timeout=2)
        pending = api.get("/health")
        assert pending.status_code == 503
        assert pending.json()["code"] == "RETENTION_NOT_READY"

        store.allow_purge.set()
        wait_for_health(api)


def test_storage_outage_returns_sanitized_retryable_503(tmp_path: Path) -> None:
    store = UnavailableTemplateStore()
    engine = FakeEngine([np.asarray([1.0, 0.0], dtype=np.float32)])
    app = create_app(settings(tmp_path), engine=engine, store=store)  # type: ignore[arg-type]

    with TestClient(app) as api:
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline and not app.state.retention_healthy:
            time.sleep(0.01)
        assert app.state.retention_healthy is True

        health = api.get("/health")
        assert health.status_code == 503
        assert health.json()["code"] == "TEMPLATE_STORAGE_UNAVAILABLE"
        assert health.json()["retryable"] is True
        assert "simulated" not in health.text

        enrollment = api.post("/v1/enroll", headers=auth(), json={**payload(), "retentionDays": 30})
        assert enrollment.status_code == 503
        assert enrollment.json()["code"] == "TEMPLATE_STORAGE_UNAVAILABLE"
        assert "simulated" not in enrollment.text


def test_request_body_limit_rejects_before_processing(tmp_path: Path) -> None:
    with client(tmp_path, []) as api:
        response = api.post(
            "/v1/enroll",
            headers={**auth(), "Content-Length": "20000000", "Content-Type": "application/json"},
            content=b"{}",
        )
        assert response.status_code == 413
        assert response.json()["code"] == "REQUEST_TOO_LARGE"


def test_enroll_verify_mismatch_and_revoke_counterflows(tmp_path: Path) -> None:
    embeddings = [
        np.asarray([1.0, 0.0], dtype=np.float32),
        np.asarray([1.0, 0.0], dtype=np.float32),
        np.asarray([0.0, 1.0], dtype=np.float32),
    ]
    with client(tmp_path, embeddings) as api:
        enrollment = api.post("/v1/enroll", headers=auth(), json={**payload(), "retentionDays": 30})
        assert enrollment.status_code == 200
        template_ref = enrollment.json()["templateRef"]

        verified = api.post(
            "/v1/verify-one-to-one",
            headers=auth(),
            json={**payload("challenge-0002"), "templateRef": template_ref},
        )
        assert verified.status_code == 200
        assert verified.json()["matched"] is True

        mismatch = api.post(
            "/v1/verify-one-to-one",
            headers=auth(),
            json={**payload("challenge-0003"), "templateRef": template_ref},
        )
        assert mismatch.status_code == 200
        assert mismatch.json()["matched"] is False

        revoked = api.post(
            "/v1/templates/revoke",
            headers=auth(),
            json={"tenantRef": "tenant-a", "subjectRef": "user-1", "templateRef": template_ref},
        )
        assert revoked.json() == {"revoked": True, "providerStatus": "REVOKED"}
        repeated = api.post(
            "/v1/templates/revoke",
            headers=auth(),
            json={"tenantRef": "tenant-a", "subjectRef": "user-1", "templateRef": template_ref},
        )
        assert repeated.json()["providerStatus"] == "ALREADY_REVOKED_OR_UNKNOWN"


def test_cross_tenant_template_use_is_rejected(tmp_path: Path) -> None:
    embeddings = [np.asarray([1.0, 0.0], dtype=np.float32), np.asarray([1.0, 0.0], dtype=np.float32)]
    with client(tmp_path, embeddings) as api:
        enrollment = api.post("/v1/enroll", headers=auth(), json={**payload(), "retentionDays": 30})
        template_ref = enrollment.json()["templateRef"]
        cross_tenant = {
            **payload("challenge-0004"),
            "tenantRef": "tenant-b",
            "templateRef": template_ref,
        }
        response = api.post("/v1/verify-one-to-one", headers=auth(), json=cross_tenant)
        assert response.status_code == 404
        assert response.json()["code"] == "TEMPLATE_NOT_FOUND"


def test_cross_tenant_template_revocation_is_a_safe_noop(tmp_path: Path) -> None:
    embeddings = [np.asarray([1.0, 0.0], dtype=np.float32), np.asarray([1.0, 0.0], dtype=np.float32)]
    with client(tmp_path, embeddings) as api:
        enrollment = api.post("/v1/enroll", headers=auth(), json={**payload(), "retentionDays": 30})
        template_ref = enrollment.json()["templateRef"]
        denied = api.post(
            "/v1/templates/revoke",
            headers=auth(),
            json={"tenantRef": "tenant-b", "subjectRef": "user-1", "templateRef": template_ref},
        )
        assert denied.json() == {"revoked": False, "providerStatus": "ALREADY_REVOKED_OR_UNKNOWN"}
        verified = api.post(
            "/v1/verify-one-to-one",
            headers=auth(),
            json={**payload("challenge-0005"), "templateRef": template_ref},
        )
        assert verified.json()["matched"] is True


def test_verify_rejects_same_dimension_template_from_another_model(tmp_path: Path) -> None:
    current = settings(tmp_path)
    store = TemplateStore(
        current.database_url,
        TemplateCipher(current.template_encryption_key),
        current.identifier_hash_key,
    )
    store.initialize()
    template_ref = store.enroll(
        tenant_ref="tenant-a",
        subject_ref="user-1",
        challenge_ref="legacy-enrollment",
        model_name="legacy-model-v1",
        embedding=np.asarray([1.0, 0.0], dtype=np.float32),
        retention_days=30,
        evidence_fingerprint="legacy-evidence",
    )
    app = create_app(
        current,
        engine=FakeEngine([np.asarray([1.0, 0.0], dtype=np.float32)]),
        store=store,
    )  # type: ignore[arg-type]

    with TestClient(app) as api:
        response = api.post(
            "/v1/verify-one-to-one",
            headers=auth(),
            json={**payload("model-upgrade-check"), "templateRef": template_ref},
        )

    assert response.status_code == 409
    assert response.json()["code"] == "TEMPLATE_MODEL_MISMATCH"
