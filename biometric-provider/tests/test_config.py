from __future__ import annotations

import pytest

from app.config import Settings


def base_env() -> dict[str, str]:
    return {
        "FACE_ENV": "test",
        "FACE_AUTH_TOKENS": "a" * 32,
        "FACE_TEMPLATE_ENCRYPTION_KEY": "11" * 32,
        "FACE_IDENTIFIER_HASH_KEY": "22" * 32,
    }


def test_rejects_short_token() -> None:
    env = base_env()
    env["FACE_AUTH_TOKENS"] = "short"
    with pytest.raises(ValueError, match="al menos 32"):
        Settings.from_env(env)


def test_rejects_reused_keys() -> None:
    env = base_env()
    env["FACE_IDENTIFIER_HASH_KEY"] = env["FACE_TEMPLATE_ENCRYPTION_KEY"]
    with pytest.raises(ValueError, match="diferentes"):
        Settings.from_env(env)


def test_production_requires_shared_database() -> None:
    env = base_env()
    env["FACE_ENV"] = "production"
    env["FACE_DATABASE_URL"] = "sqlite:///data.db"
    with pytest.raises(ValueError, match="MySQL o PostgreSQL"):
        Settings.from_env(env)


def test_production_rejects_sqlite_driver_variants() -> None:
    env = base_env()
    env["FACE_ENV"] = "production"
    env["FACE_DATABASE_URL"] = "sqlite+pysqlite:///data.db"
    with pytest.raises(ValueError, match="MySQL o PostgreSQL"):
        Settings.from_env(env)


def test_production_accepts_explicit_shared_database_driver() -> None:
    env = base_env()
    env["FACE_ENV"] = "production"
    env["FACE_DATABASE_URL"] = "mysql+pymysql://face:secret@db/templates"
    assert Settings.from_env(env).database_url == env["FACE_DATABASE_URL"]


def test_parses_multiple_rotation_tokens() -> None:
    env = base_env()
    env["FACE_AUTH_TOKENS"] = f"{'a' * 32},{'b' * 40}"
    settings = Settings.from_env(env)
    assert settings.auth_tokens == ("a" * 32, "b" * 40)
