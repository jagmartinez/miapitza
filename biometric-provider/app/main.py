from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

import numpy as np
from fastapi import Depends, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__
from .config import Settings
from .crypto import TemplateCipher
from .engine import FaceEngine
from .errors import BiometricError
from .schemas import EnrollRequest, EnrollResponse, RevokeRequest, RevokeResponse, VerifyRequest, VerifyResponse
from .security import BearerAuthenticator
from .storage import TemplateStore

LOGGER = logging.getLogger("mia-face-provider")
REQUESTS = Counter("face_provider_requests_total", "Solicitudes por ruta y resultado", ["route", "method", "status"])
LATENCY = Histogram("face_provider_request_seconds", "Latencia por ruta", ["route", "method"])
INFERENCES = Counter("face_provider_inferences_total", "Inferencias por operacion y resultado", ["operation", "result"])


def _log(event: str, **fields: Any) -> None:
    LOGGER.info(json.dumps({"event": event, **fields}, separators=(",", ":"), default=str))


def evidence_fingerprint(payload: EnrollRequest) -> str:
    digest = hashlib.sha256()
    digest.update(f"face-enroll-v1|{payload.liveness_action}|{payload.require_liveness}".encode())
    for capture in payload.captures:
        digest.update(capture.mime_type.encode())
        digest.update(b"|")
        digest.update(capture.content_base64.encode())
        digest.update(b"|")
    return digest.hexdigest()


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        raw_length = headers.get(b"content-length", b"").decode()
        if raw_length.isdigit() and int(raw_length) > self.max_bytes:
            response = JSONResponse(
                status_code=413,
                content={"code": "REQUEST_TOO_LARGE", "message": "La solicitud excede el limite", "retryable": True},
            )
            await response(scope, receive, send)
            return
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise BiometricError("REQUEST_TOO_LARGE", "La solicitud excede el limite", status_code=413)
            return message

        await self.app(scope, limited_receive, send)


def create_app(
    settings: Settings | None = None,
    *,
    engine: FaceEngine | None = None,
    store: TemplateStore | None = None,
) -> FastAPI:
    resolved = settings or Settings.from_env()
    resolved_engine = engine or FaceEngine(resolved)
    resolved_store = store or TemplateStore(
        resolved.database_url,
        TemplateCipher(resolved.template_encryption_key),
        resolved.identifier_hash_key,
    )
    authenticator = BearerAuthenticator(resolved.auth_tokens)
    semaphore = asyncio.Semaphore(resolved.max_concurrency)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        await asyncio.to_thread(resolved_store.initialize)
        await asyncio.to_thread(resolved_engine.initialize)
        retention_stop = asyncio.Event()

        async def retention_worker() -> None:
            while not retention_stop.is_set():
                try:
                    purged = await asyncio.to_thread(resolved_store.purge_expired)
                    if purged:
                        _log("expired_templates_purged", count=purged)
                except Exception as exc:  # pragma: no cover - dependency outage is observed in integration/health
                    _log("retention_worker_error", errorType=type(exc).__name__)
                try:
                    await asyncio.wait_for(retention_stop.wait(), timeout=resolved.purge_interval_seconds)
                except TimeoutError:
                    continue

        retention_task = asyncio.create_task(retention_worker(), name="face-template-retention")
        app.state.ready = True
        _log("provider_ready", model=resolved.model_name, environment=resolved.environment)
        try:
            yield
        finally:
            app.state.ready = False
            retention_stop.set()
            await retention_task

    app = FastAPI(
        title="MIA Face Provider",
        version=__version__,
        docs_url="/docs" if resolved.environment != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if resolved.environment != "production" else None,
        lifespan=lifespan,
    )
    app.state.ready = False
    app.state.settings = resolved
    app.add_middleware(BodyLimitMiddleware, max_bytes=resolved.max_request_bytes)

    async def analyze_evidence(payload: EnrollRequest | VerifyRequest):
        try:
            await asyncio.wait_for(semaphore.acquire(), timeout=resolved.queue_timeout_seconds)
        except TimeoutError as exc:
            raise BiometricError(
                "PROVIDER_BUSY",
                "El proveedor biometrico esta ocupado; reintente en unos segundos",
                status_code=503,
            ) from exc
        try:
            return await asyncio.to_thread(
                resolved_engine.analyze,
                payload.captures,
                payload.liveness_action,
                payload.require_liveness,
            )
        finally:
            semaphore.release()

    @app.middleware("http")
    async def request_context(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        request_id = request.headers.get("X-Request-Id", "").strip()[:100] or str(uuid4())
        request.state.request_id = request_id
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        except BiometricError as exc:
            status = exc.status_code
            response = JSONResponse(
                status_code=exc.status_code,
                content={"code": exc.code, "message": exc.message, "retryable": exc.retryable, "requestId": request_id},
            )
        route = request.scope.get("route")
        route_name = getattr(route, "path", "unmatched")
        elapsed = time.perf_counter() - started
        REQUESTS.labels(route_name, request.method, str(status)).inc()
        LATENCY.labels(route_name, request.method).observe(elapsed)
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        _log("request_complete", requestId=request_id, route=route_name, method=request.method, status=status, durationMs=round(elapsed * 1000, 2))
        return response

    @app.exception_handler(BiometricError)
    async def biometric_error_handler(request: Request, exc: BiometricError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "code": exc.code,
                "message": exc.message,
                "retryable": exc.retryable,
                "requestId": getattr(request.state, "request_id", None),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, _exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "code": "REQUEST_INVALID",
                "message": "La solicitud biometrica no cumple el contrato",
                "retryable": True,
                "requestId": getattr(request.state, "request_id", None),
            },
        )

    @app.exception_handler(Exception)
    async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
        _log("unexpected_error", requestId=getattr(request.state, "request_id", None), errorType=type(exc).__name__)
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "El proveedor biometrico no pudo completar la operacion",
                "retryable": True,
                "requestId": getattr(request.state, "request_id", None),
            },
        )

    auth = Depends(authenticator.verify)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        if not app.state.ready:
            raise BiometricError("NOT_READY", "El proveedor aun no esta listo", status_code=503)
        await asyncio.to_thread(resolved_store.health_check)
        return {"status": "ok", "provider": "mia-face-provider", "model": resolved.model_name, "version": __version__}

    @app.get("/ready", dependencies=[auth])
    async def ready() -> dict[str, Any]:
        return await health()

    @app.get("/metrics", dependencies=[auth], response_class=PlainTextResponse)
    async def metrics() -> Response:
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.post("/v1/enroll", response_model=EnrollResponse, dependencies=[auth])
    async def enroll(payload: EnrollRequest) -> EnrollResponse:
        try:
            analysis = await analyze_evidence(payload)
            template_ref = await asyncio.to_thread(
                resolved_store.enroll,
                tenant_ref=payload.tenant_ref,
                subject_ref=payload.subject_ref,
                challenge_ref=payload.challenge_ref,
                model_name=resolved.model_name,
                embedding=analysis.embedding,
                retention_days=payload.retention_days,
                evidence_fingerprint=evidence_fingerprint(payload),
            )
            INFERENCES.labels("enroll", "success").inc()
            return EnrollResponse(
                templateRef=template_ref,
                livenessPassed=analysis.liveness_passed,
                providerStatus="ENROLLED",
            )
        except BiometricError:
            INFERENCES.labels("enroll", "rejected").inc()
            raise

    @app.post("/v1/verify-one-to-one", response_model=VerifyResponse, dependencies=[auth])
    async def verify(payload: VerifyRequest) -> VerifyResponse:
        try:
            analysis = await analyze_evidence(payload)
            enrolled_embedding = await asyncio.to_thread(
                resolved_store.load,
                template_ref=payload.template_ref,
                tenant_ref=payload.tenant_ref,
                subject_ref=payload.subject_ref,
            )
            if enrolled_embedding.shape != analysis.embedding.shape:
                raise BiometricError("TEMPLATE_MODEL_MISMATCH", "La plantilla requiere reenrolamiento", status_code=409, retryable=False)
            cosine = float(np.dot(enrolled_embedding, analysis.embedding))
            score = min(1.0, max(0.0, cosine))
            matched = cosine >= resolved.match_threshold
            INFERENCES.labels("verify", "matched" if matched else "not_matched").inc()
            return VerifyResponse(
                matched=matched,
                livenessPassed=analysis.liveness_passed,
                score=round(score, 6),
                providerStatus="VERIFIED" if matched else "NOT_MATCHED",
            )
        except BiometricError:
            INFERENCES.labels("verify", "rejected").inc()
            raise

    @app.post("/v1/templates/revoke", response_model=RevokeResponse, dependencies=[auth])
    async def revoke(payload: RevokeRequest) -> RevokeResponse:
        revoked = await asyncio.to_thread(
            resolved_store.revoke,
            template_ref=payload.template_ref,
            tenant_ref=payload.tenant_ref,
            subject_ref=payload.subject_ref,
        )
        return RevokeResponse(
            revoked=revoked,
            providerStatus="REVOKED" if revoked else "ALREADY_REVOKED_OR_UNKNOWN",
        )

    return app


app = create_app()
