from __future__ import annotations

import sqlite3
from pathlib import Path

import numpy as np
import pytest

from app.crypto import TemplateCipher
from app.errors import BiometricError
from app.storage import TemplateStore


def test_template_cipher_detects_tampering() -> None:
    cipher = TemplateCipher(bytes.fromhex("11" * 32))
    embedding = np.asarray([0.1, 0.2, 0.3], dtype=np.float32)
    encrypted = cipher.encrypt("template", "model", embedding)
    restored = cipher.decrypt("template", "model", encrypted)
    assert np.allclose(restored, embedding)
    mutation_index = len(encrypted) // 2
    replacement = "A" if encrypted[mutation_index] != "A" else "B"
    with pytest.raises(Exception):
        cipher.decrypt("template", "model", encrypted[:mutation_index] + replacement + encrypted[mutation_index + 1 :])


def make_store(tmp_path: Path) -> TemplateStore:
    store = TemplateStore(
        f"sqlite:///{tmp_path / 'templates.db'}",
        TemplateCipher(bytes.fromhex("11" * 32)),
        bytes.fromhex("22" * 32),
    )
    store.initialize()
    return store


def test_initialize_fails_closed_for_an_outdated_schema(tmp_path: Path) -> None:
    database = tmp_path / "outdated.db"
    with sqlite3.connect(database) as connection:
        connection.execute("CREATE TABLE face_templates (id INTEGER PRIMARY KEY)")
    store = TemplateStore(
        f"sqlite:///{database}",
        TemplateCipher(bytes.fromhex("11" * 32)),
        bytes.fromhex("22" * 32),
    )
    with pytest.raises(RuntimeError, match="Esquema face_templates incompatible"):
        store.initialize()


def test_enrollment_is_idempotent_and_tenant_scoped(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    embedding = np.asarray([1.0, 0.0], dtype=np.float32)
    first = store.enroll(
        tenant_ref="tenant-a",
        subject_ref="user-1",
        challenge_ref="challenge-1",
        model_name="model-v1",
        embedding=embedding,
        retention_days=10,
        evidence_fingerprint="evidence-a",
    )
    repeated = store.enroll(
        tenant_ref="tenant-a",
        subject_ref="user-1",
        challenge_ref="challenge-1",
        model_name="model-v1",
        embedding=embedding,
        retention_days=10,
        evidence_fingerprint="evidence-a",
    )
    assert repeated == first
    with pytest.raises(BiometricError, match="evidencia diferente"):
        store.enroll(
            tenant_ref="tenant-a",
            subject_ref="user-1",
            challenge_ref="challenge-1",
            model_name="model-v1",
            embedding=embedding,
            retention_days=10,
            evidence_fingerprint="different-evidence",
        )
    assert np.allclose(store.load(template_ref=first, tenant_ref="tenant-a", subject_ref="user-1"), embedding)
    with pytest.raises(BiometricError, match="Plantilla no encontrada"):
        store.load(template_ref=first, tenant_ref="tenant-b", subject_ref="user-1")


def test_reenrollment_keeps_previous_template_until_explicit_revoke(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    first = store.enroll(
        tenant_ref="tenant-a",
        subject_ref="user-1",
        challenge_ref="challenge-1",
        model_name="model-v1",
        embedding=np.asarray([1.0, 0.0], dtype=np.float32),
        retention_days=10,
        evidence_fingerprint="evidence-a",
    )
    second = store.enroll(
        tenant_ref="tenant-a",
        subject_ref="user-1",
        challenge_ref="challenge-2",
        model_name="model-v1",
        embedding=np.asarray([0.9, 0.1], dtype=np.float32),
        retention_days=10,
        evidence_fingerprint="evidence-b",
    )
    assert first != second
    assert store.load(template_ref=first, tenant_ref="tenant-a", subject_ref="user-1").shape == (2,)
    assert store.revoke(template_ref=first, tenant_ref="tenant-b", subject_ref="user-1") is False
    assert store.revoke(template_ref=first, tenant_ref="tenant-a", subject_ref="user-1") is True
    assert store.revoke(template_ref=first, tenant_ref="tenant-a", subject_ref="user-1") is False
    with pytest.raises(BiometricError, match="revocada"):
        store.load(template_ref=first, tenant_ref="tenant-a", subject_ref="user-1")


def test_expired_template_material_is_purged(tmp_path: Path) -> None:
    store = make_store(tmp_path)
    template_ref = store.enroll(
        tenant_ref="tenant-a",
        subject_ref="user-1",
        challenge_ref="expired-challenge",
        model_name="model-v1",
        embedding=np.asarray([1.0, 0.0], dtype=np.float32),
        retention_days=-1,
        evidence_fingerprint="expired-evidence",
    )
    assert store.purge_expired() == 1
    assert store.purge_expired() == 0
    with pytest.raises(BiometricError, match="revocada"):
        store.load(template_ref=template_ref, tenant_ref="tenant-a", subject_ref="user-1")
