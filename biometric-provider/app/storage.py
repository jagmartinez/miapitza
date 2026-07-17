from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import numpy as np
from sqlalchemy import Boolean, DateTime, Integer, String, Text, create_engine, inspect, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from .crypto import TemplateCipher, stable_hash
from .errors import BiometricError


class Base(DeclarativeBase):
    pass


class FaceTemplate(Base):
    __tablename__ = "face_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_ref: Mapped[str] = mapped_column(String(36), unique=True, index=True, nullable=False)
    tenant_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    subject_hash: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    challenge_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    enrollment_fingerprint_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_embedding: Mapped[str] = mapped_column(Text, nullable=False)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    embedding_dimension: Mapped[int] = mapped_column(Integer, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TemplateStore:
    def __init__(self, database_url: str, cipher: TemplateCipher, identifier_key: bytes) -> None:
        normalized_url = database_url
        if database_url.startswith("mysql://"):
            normalized_url = database_url.replace("mysql://", "mysql+pymysql://", 1)
        elif database_url.startswith("postgres://"):
            normalized_url = database_url.replace("postgres://", "postgresql+psycopg://", 1)
        elif database_url.startswith("postgresql://") and "+" not in database_url.split(":", 1)[0]:
            normalized_url = database_url.replace("postgresql://", "postgresql+psycopg://", 1)
        connect_args = {"check_same_thread": False} if normalized_url.startswith("sqlite:") else {}
        self._engine = create_engine(normalized_url, pool_pre_ping=True, connect_args=connect_args)
        self._cipher = cipher
        self._identifier_key = identifier_key

    def initialize(self) -> None:
        Base.metadata.create_all(self._engine)
        columns = {column["name"] for column in inspect(self._engine).get_columns(FaceTemplate.__tablename__)}
        expected = {column.name for column in FaceTemplate.__table__.columns}
        missing = sorted(expected - columns)
        if missing:
            raise RuntimeError(
                "Esquema face_templates incompatible; aplique la migracion antes de iniciar: " + ", ".join(missing)
            )
        self.health_check()

    def health_check(self) -> None:
        with self._engine.connect() as connection:
            connection.execute(text("SELECT 1"))

    def purge_expired(self) -> int:
        now = datetime.now(UTC)
        with Session(self._engine) as session:
            result = session.execute(
                update(FaceTemplate)
                .where(FaceTemplate.expires_at <= now, FaceTemplate.encrypted_embedding != "PURGED")
                .values(active=False, revoked_at=now, encrypted_embedding="PURGED")
            )
            session.commit()
            return int(result.rowcount or 0)

    def _hashes(self, tenant_ref: str, subject_ref: str) -> tuple[str, str]:
        return (
            stable_hash(self._identifier_key, "tenant", tenant_ref),
            stable_hash(self._identifier_key, "subject", f"{tenant_ref}|{subject_ref}"),
        )

    def enroll(
        self,
        *,
        tenant_ref: str,
        subject_ref: str,
        challenge_ref: str,
        model_name: str,
        embedding: np.ndarray,
        retention_days: int,
        evidence_fingerprint: str,
    ) -> str:
        tenant_hash, subject_hash = self._hashes(tenant_ref, subject_ref)
        challenge_hash = stable_hash(self._identifier_key, "challenge", f"{tenant_ref}|{subject_ref}|{challenge_ref}")
        fingerprint_hash = stable_hash(self._identifier_key, "enrollment-evidence", evidence_fingerprint)
        now = datetime.now(UTC)
        with Session(self._engine) as session:
            existing = session.scalar(select(FaceTemplate).where(FaceTemplate.challenge_hash == challenge_hash))
            if existing:
                if existing.tenant_hash != tenant_hash or existing.subject_hash != subject_hash:
                    raise BiometricError("CHALLENGE_CONFLICT", "El reto ya pertenece a otra identidad", status_code=409, retryable=False)
                if existing.enrollment_fingerprint_hash != fingerprint_hash:
                    raise BiometricError(
                        "CHALLENGE_IDEMPOTENCY_MISMATCH",
                        "El reto fue reutilizado con evidencia diferente",
                        status_code=409,
                        retryable=False,
                    )
                if not existing.active:
                    raise BiometricError("TEMPLATE_REVOKED", "La plantilla idempotente ya fue revocada", status_code=409, retryable=False)
                return existing.public_ref
            public_ref = str(uuid4())
            encrypted = self._cipher.encrypt(public_ref, model_name, embedding)
            session.add(
                FaceTemplate(
                    public_ref=public_ref,
                    tenant_hash=tenant_hash,
                    subject_hash=subject_hash,
                    challenge_hash=challenge_hash,
                    enrollment_fingerprint_hash=fingerprint_hash,
                    encrypted_embedding=encrypted,
                    model_name=model_name,
                    embedding_dimension=int(embedding.size),
                    active=True,
                    created_at=now,
                    expires_at=now + timedelta(days=retention_days),
                )
            )
            try:
                session.commit()
            except IntegrityError as exc:
                session.rollback()
                raced = session.scalar(select(FaceTemplate).where(FaceTemplate.challenge_hash == challenge_hash))
                if raced and raced.tenant_hash == tenant_hash and raced.subject_hash == subject_hash:
                    if raced.enrollment_fingerprint_hash != fingerprint_hash:
                        raise BiometricError(
                            "CHALLENGE_IDEMPOTENCY_MISMATCH",
                            "El reto fue reutilizado con evidencia diferente",
                            status_code=409,
                            retryable=False,
                        ) from exc
                    if raced.active:
                        return raced.public_ref
                raise BiometricError("ENROLLMENT_CONFLICT", "El enrolamiento cambio concurrentemente", status_code=409) from exc
            return public_ref

    def load(self, *, template_ref: str, tenant_ref: str, subject_ref: str) -> np.ndarray:
        tenant_hash, subject_hash = self._hashes(tenant_ref, subject_ref)
        with Session(self._engine) as session:
            item = session.scalar(select(FaceTemplate).where(FaceTemplate.public_ref == template_ref))
            if not item or item.tenant_hash != tenant_hash or item.subject_hash != subject_hash:
                raise BiometricError("TEMPLATE_NOT_FOUND", "Plantilla no encontrada para la identidad", status_code=404, retryable=False)
            now = datetime.now(UTC)
            expires_at = item.expires_at.replace(tzinfo=UTC) if item.expires_at.tzinfo is None else item.expires_at
            if not item.active or item.revoked_at is not None:
                raise BiometricError("TEMPLATE_REVOKED", "La plantilla fue revocada", status_code=410, retryable=False)
            if expires_at <= now:
                item.active = False
                item.revoked_at = now
                session.commit()
                raise BiometricError("TEMPLATE_EXPIRED", "La plantilla expiro", status_code=410, retryable=False)
            return self._cipher.decrypt(item.public_ref, item.model_name, item.encrypted_embedding)

    def revoke(self, *, template_ref: str, tenant_ref: str, subject_ref: str) -> bool:
        tenant_hash, subject_hash = self._hashes(tenant_ref, subject_ref)
        now = datetime.now(UTC)
        with Session(self._engine) as session:
            result = session.execute(
                update(FaceTemplate)
                .where(
                    FaceTemplate.public_ref == template_ref,
                    FaceTemplate.tenant_hash == tenant_hash,
                    FaceTemplate.subject_hash == subject_hash,
                    FaceTemplate.active.is_(True),
                )
                .values(active=False, revoked_at=now, encrypted_embedding="PURGED")
            )
            session.commit()
            return bool(result.rowcount)
