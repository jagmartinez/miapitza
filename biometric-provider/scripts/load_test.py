from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import time
from collections import Counter
from pathlib import Path
from uuid import uuid4

import httpx


async def run(args: argparse.Namespace) -> int:
    token = os.getenv("FACE_LOAD_TEST_TOKEN", "").strip()
    if len(token) < 32:
        raise SystemExit("FACE_LOAD_TEST_TOKEN debe contener el Bearer de prueba")
    payload = json.loads(args.evidence.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or not payload.get("templateRef"):
        raise SystemExit("El JSON debe ser un payload valido de verify-one-to-one con templateRef")
    semaphore = asyncio.Semaphore(args.concurrency)
    latencies: list[float] = []
    statuses: Counter[str] = Counter()

    async with httpx.AsyncClient(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {token}"},
        timeout=args.timeout,
        verify=not args.allow_insecure_tls,
        limits=httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency),
    ) as client:
        async def one() -> None:
            request_payload = {**payload, "challengeRef": str(uuid4())}
            async with semaphore:
                started = time.perf_counter()
                try:
                    response = await client.post("/v1/verify-one-to-one", json=request_payload)
                    statuses[str(response.status_code)] += 1
                except httpx.HTTPError:
                    statuses["network_error"] += 1
                finally:
                    latencies.append(time.perf_counter() - started)

        started = time.perf_counter()
        await asyncio.gather(*(one() for _ in range(args.requests)))
        elapsed = time.perf_counter() - started

    ordered = sorted(latencies)

    def percentile(ratio: float) -> float:
        return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * ratio))] * 1000

    summary = {
        "requests": args.requests,
        "concurrency": args.concurrency,
        "durationSeconds": round(elapsed, 3),
        "requestsPerSecond": round(args.requests / elapsed, 2),
        "latencyMs": {
            "mean": round(statistics.fmean(latencies) * 1000, 2),
            "p50": round(percentile(0.50), 2),
            "p95": round(percentile(0.95), 2),
            "p99": round(percentile(0.99), 2),
        },
        "statuses": dict(statuses),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))
    return 0 if statuses.get("200", 0) == args.requests else 1


def main() -> None:
    parser = argparse.ArgumentParser(description="Carga 1:1 sin imprimir evidencia ni respuestas biometricas")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--requests", type=int, default=50, choices=range(1, 10_001))
    parser.add_argument("--concurrency", type=int, default=2, choices=range(1, 65))
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--allow-insecure-tls", action="store_true")
    args = parser.parse_args()
    raise SystemExit(asyncio.run(run(args)))


if __name__ == "__main__":
    main()
