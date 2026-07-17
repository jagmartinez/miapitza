from __future__ import annotations

import os

os.environ.setdefault("FACE_ENV", "test")
os.environ.setdefault("FACE_AUTH_TOKENS", "test-token-with-at-least-thirty-two-characters")
os.environ.setdefault("FACE_TEMPLATE_ENCRYPTION_KEY", "11" * 32)
os.environ.setdefault("FACE_IDENTIFIER_HASH_KEY", "22" * 32)
os.environ.setdefault("FACE_DATABASE_URL", "sqlite:///:memory:")
