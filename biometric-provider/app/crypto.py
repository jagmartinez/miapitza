from __future__ import annotations

import base64
import hmac
import os
import struct

import numpy as np
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class TemplateCipher:
    VERSION = 1

    def __init__(self, key: bytes) -> None:
        if len(key) != 32:
            raise ValueError("La clave AES-256 debe tener 32 bytes")
        self._cipher = AESGCM(key)

    @staticmethod
    def _aad(template_ref: str, model_name: str, dimension: int) -> bytes:
        return f"face-template|{template_ref}|{model_name}|{dimension}".encode()

    def encrypt(self, template_ref: str, model_name: str, embedding: np.ndarray) -> str:
        normalized = np.asarray(embedding, dtype="<f4").reshape(-1)
        nonce = os.urandom(12)
        header = struct.pack(">BH", self.VERSION, normalized.size)
        ciphertext = self._cipher.encrypt(
            nonce,
            normalized.tobytes(order="C"),
            self._aad(template_ref, model_name, normalized.size),
        )
        return base64.urlsafe_b64encode(header + nonce + ciphertext).decode().rstrip("=")

    def decrypt(self, template_ref: str, model_name: str, payload: str) -> np.ndarray:
        padded = payload + "=" * (-len(payload) % 4)
        raw = base64.urlsafe_b64decode(padded)
        if len(raw) < 3 + 12 + 16:
            raise ValueError("Plantilla cifrada truncada")
        version, dimension = struct.unpack(">BH", raw[:3])
        if version != self.VERSION or dimension <= 0 or dimension > 4096:
            raise ValueError("Version o dimension de plantilla invalida")
        plaintext = self._cipher.decrypt(
            raw[3:15],
            raw[15:],
            self._aad(template_ref, model_name, dimension),
        )
        if len(plaintext) != dimension * 4:
            raise ValueError("Dimension de plantilla inconsistente")
        return np.frombuffer(plaintext, dtype="<f4").astype(np.float32, copy=True)


def stable_hash(key: bytes, namespace: str, value: str) -> str:
    return hmac.new(key, f"{namespace}|{value}".encode(), "sha256").hexdigest()
