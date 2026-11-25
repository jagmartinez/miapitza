import dotenv from 'dotenv';
import http from 'node:http';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';

type ProbeMetric = {
  requests: number;
  successes: number;
  failures: number;
  durationMs: number;
  requestsPerSecond: number;
  latencyMs: { min: number; p50: number; p95: number; p99: number; max: number };
  statusCounts: Record<string, number>;
};

function integerFlag(name: string, fallback: number, min: number, max: number): number {
  const index = process.argv.indexOf(name);
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function assertSafeEnvironment(): void {
  if (process.env.RELEASE_HARNESS_ALLOW_LOCAL !== 'true') {
    throw new Error('Set RELEASE_HARNESS_ALLOW_LOCAL=true to run the local release harness');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Release harness is forbidden with NODE_ENV=production');
  }
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) throw new Error('DATABASE_URL is required');
  const url = new URL(rawUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !database.endsWith('_test')) {
    throw new Error('Release harness requires a localhost database ending in _test');
  }
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function timedRequest(url: string, init?: RequestInit): Promise<{ status: number; latencyMs: number }> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);
  timeout.unref?.();
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    await response.arrayBuffer();
    return { status: response.status, latencyMs: performance.now() - started };
  } finally {
    clearTimeout(timeout);
  }
}

async function loadProbe(url: string, requests: number, concurrency: number): Promise<ProbeMetric> {
  const latencies: number[] = [];
  const statusCounts: Record<string, number> = {};
  let next = 0;
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const current = next++;
      if (current >= requests) return;
      try {
        const result = await timedRequest(url);
        latencies.push(result.latencyMs);
        statusCounts[String(result.status)] = (statusCounts[String(result.status)] || 0) + 1;
      } catch (error) {
        const key = error instanceof Error ? error.name : 'ERROR';
        statusCounts[key] = (statusCounts[key] || 0) + 1;
      }
    }
  }));
  const durationMs = performance.now() - started;
  latencies.sort((a, b) => a - b);
  const successes = statusCounts['200'] || 0;
  return {
    requests,
    successes,
    failures: requests - successes,
    durationMs: Number(durationMs.toFixed(2)),
    requestsPerSecond: Number((requests / (durationMs / 1000)).toFixed(2)),
    latencyMs: {
      min: Number((latencies[0] || 0).toFixed(2)),
      p50: Number(percentile(latencies, 0.50).toFixed(2)),
      p95: Number(percentile(latencies, 0.95).toFixed(2)),
      p99: Number(percentile(latencies, 0.99).toFixed(2)),
      max: Number((latencies.at(-1) || 0).toFixed(2))
    },
    statusCounts
  };
}

async function soakProbe(url: string, durationMs: number, concurrency: number): Promise<ProbeMetric> {
  const deadline = performance.now() + durationMs;
  const results: Array<{ status: number; latencyMs: number }> = [];
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < deadline) {
      results.push(await timedRequest(url));
    }
  }));
  const elapsed = performance.now() - started;
  const latencies = results.map((result) => result.latencyMs).sort((a, b) => a - b);
  const statusCounts: Record<string, number> = {};
  for (const result of results) statusCounts[String(result.status)] = (statusCounts[String(result.status)] || 0) + 1;
  const successes = statusCounts['200'] || 0;
  return {
    requests: results.length,
    successes,
    failures: results.length - successes,
    durationMs: Number(elapsed.toFixed(2)),
    requestsPerSecond: Number((results.length / (elapsed / 1000)).toFixed(2)),
    latencyMs: {
      min: Number((latencies[0] || 0).toFixed(2)),
      p50: Number(percentile(latencies, 0.50).toFixed(2)),
      p95: Number(percentile(latencies, 0.95).toFixed(2)),
      p99: Number(percentile(latencies, 0.99).toFixed(2)),
      max: Number((latencies.at(-1) || 0).toFixed(2))
    },
    statusCounts
  };
}

async function unauthenticatedWebSocketCloses(url: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { Origin: 'http://localhost:5173' } });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('WebSocket authentication failure did not close within 2s'));
    }, 2_000);
    timer.unref?.();
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
    socket.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function main(): Promise<void> {
  dotenv.config({ path: process.env.RELEASE_HARNESS_ENV || '.env.test', override: true });
  assertSafeEnvironment();

  const requests = integerFlag('--requests', 300, 10, 5_000);
  const concurrency = integerFlag('--concurrency', 16, 1, 64);
  const soakMs = integerFlag('--soak-ms', 5_000, 1_000, 60_000);
  const maxP95Ms = integerFlag('--max-p95-ms', 1_500, 50, 10_000);

  const [{ default: app }, { default: prisma }, { WebSocketService }] = await Promise.all([
    import('../src/app'),
    import('../src/utils/prisma'),
    import('../src/services/websocket.service')
  ]);

  const server = http.createServer(app);
  WebSocketService.initialize(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not resolve local harness port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsUrl = `ws://127.0.0.1:${address.port}`;
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  const memoryBefore = process.memoryUsage().heapUsed;

  try {
    const warmLiveness = await timedRequest(`${baseUrl}/health`);
    const warmReadiness = await timedRequest(`${baseUrl}/api/v1/health`);
    if (warmLiveness.status !== 200 || warmReadiness.status !== 200) {
      throw new Error(`Warmup failed: liveness=${warmLiveness.status}, readiness=${warmReadiness.status}`);
    }

    const load = await loadProbe(`${baseUrl}/api/v1/health`, requests, concurrency);
    const soak = await soakProbe(`${baseUrl}/api/v1/health`, soakMs, Math.min(concurrency, 8));

    const invalidDelivery = await timedRequest(`${baseUrl}/api/delivery/webhook/uber-eats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-company-id': '1', 'x-branch-id': '1' },
      body: JSON.stringify({ id: 'sandbox-invalid-signature', items: [] })
    });
    const invalidPedidosYa = await timedRequest(`${baseUrl}/api/pedidosya/webhook/1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'ORDER_CREATED', id: 'sandbox-no-signature' })
    });
    const oversizedPayload = await timedRequest(`${baseUrl}/api/delivery/webhook/uber-eats`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-company-id': '1', 'x-branch-id': '1' },
      body: JSON.stringify({ padding: 'x'.repeat(1_100_000) })
    });
    const wsCloseCode = await unauthenticatedWebSocketCloses(wsUrl);
    const recovery = await timedRequest(`${baseUrl}/api/v1/health`);

    eventLoop.disable();
    const result = {
      environment: { host: '127.0.0.1', databaseSuffix: '_test', production: false },
      warmup: { liveness: warmLiveness, readiness: warmReadiness },
      load,
      soak,
      chaos: {
        unsignedUberRappiWebhookStatus: invalidDelivery.status,
        unsignedPedidosYaWebhookStatus: invalidPedidosYa.status,
        oversizedJsonStatus: oversizedPayload.status,
        unauthenticatedWebSocketCloseCode: wsCloseCode,
        readinessAfterFailures: recovery.status
      },
      process: {
        heapDeltaBytes: process.memoryUsage().heapUsed - memoryBefore,
        eventLoopDelayMs: {
          mean: Number((eventLoop.mean / 1e6).toFixed(2)),
          p95: Number((eventLoop.percentile(95) / 1e6).toFixed(2)),
          max: Number((eventLoop.max / 1e6).toFixed(2))
        }
      },
      limits: { maxP95Ms, requestTimeoutMs: 3_000 }
    };
    console.log(JSON.stringify(result));

    const failures = [
      load.failures === 0 ? null : `load failures=${load.failures}`,
      soak.failures === 0 ? null : `soak failures=${soak.failures}`,
      load.latencyMs.p95 <= maxP95Ms ? null : `load p95=${load.latencyMs.p95}ms`,
      soak.latencyMs.p95 <= maxP95Ms ? null : `soak p95=${soak.latencyMs.p95}ms`,
      invalidDelivery.status === 401 ? null : `unsigned delivery=${invalidDelivery.status}`,
      invalidPedidosYa.status === 401 ? null : `unsigned PedidosYa=${invalidPedidosYa.status}`,
      oversizedPayload.status === 413 ? null : `oversized JSON=${oversizedPayload.status}`,
      wsCloseCode === 4001 ? null : `unauthenticated WebSocket close=${wsCloseCode}`,
      recovery.status === 200 ? null : `readiness recovery=${recovery.status}`
    ].filter(Boolean);
    if (failures.length > 0) throw new Error(`Operational harness failed: ${failures.join(', ')}`);
  } finally {
    eventLoop.disable();
    WebSocketService.shutdown();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
