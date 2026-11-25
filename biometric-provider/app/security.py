from __future__ import annotations

import hmac

from fastapi import Header

from .errors import BiometricError


class BearerAuthenticator:
    def __init__(self, tokens: tuple[str, ...]) -> None:
        self._tokens = tokens

    def verify(self, authorization: str | None = Header(default=None)) -> None:
        if not authorization or not authorization.startswith("Bearer "):
            raise BiometricError("AUTH_REQUIRED", "Token Bearer requerido", status_code=401, retryable=False)
        supplied = authorization[7:].strip()
        if not supplied or not any(hmac.compare_digest(supplied, expected) for expected in self._tokens):
            raise BiometricError("AUTH_INVALID", "Token Bearer invalido", status_code=401, retryable=False)
