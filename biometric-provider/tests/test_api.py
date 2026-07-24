from __future__ import annotations

import base64
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

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


def test_health_and_authentication(tmp_path: Path) -> None:
    with client(tmp_path, []) as api:
        assert api.get("/health").status_code == 200
        denied = api.post("/v1/enroll", json={})
        assert denied.status_code == 401
        assert denied.json()["code"] == "AUTH_REQUIRED"


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
