#!/usr/bin/env node
/**
 * Safe capacity probe for light HTTP endpoints (no glucose writes).
 *
 * Usage:
 *   node scripts/capacity-probe.js https://aima.gms-world.com
 *   node scripts/capacity-probe.js https://aima.gms-world.com --concurrency 40 --duration 20
 *   node scripts/capacity-probe.js http://127.0.0.1:5000 --path /health/live
 *
 * Optional auth (still light GET only):
 *   set CAPACITY_TOKEN=eyJ... && node scripts/capacity-probe.js https://aima.gms-world.com --path /api/Profile
 */
const args = process.argv.slice(2);
const baseArg = args.find((a) => !a.startsWith('--'));
const getNum = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : fallback;
};
const getStr = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = (baseArg || process.env.CAPACITY_BASE_URL || '').replace(/\/$/, '');
const concurrency = getNum('--concurrency', 30);
const durationSec = getNum('--duration', 20);
const path = getStr('--path', '/health/live');
const token = process.env.CAPACITY_TOKEN || '';

if (!base) {
  console.error('Usage: node scripts/capacity-probe.js <baseUrl> [--concurrency 30] [--duration 20] [--path /health/live]');
  process.exit(2);
}

if (/sync-bulk|measurement|DietAssistant/i.test(path)) {
  console.error('Refusing write/heavy paths in this probe. Use k6 load-test.js on staging only.');
  process.exit(2);
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function sampleMetrics() {
  try {
    const res = await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function oneRequest(latencies, counters) {
  const started = performance.now();
  try {
    const res = await fetch(`${base}${path}`, {
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    const ms = performance.now() - started;
    latencies.push(ms);
    counters.total += 1;
    if (res.status >= 200 && res.status < 400) counters.ok += 1;
    else {
      counters.fail += 1;
      counters.byStatus[res.status] = (counters.byStatus[res.status] || 0) + 1;
    }
  } catch (error) {
    const ms = performance.now() - started;
    latencies.push(ms);
    counters.total += 1;
    counters.fail += 1;
    const key = error?.name === 'TimeoutError' ? 'timeout' : 'network';
    counters.byStatus[key] = (counters.byStatus[key] || 0) + 1;
  }
}

async function worker(stopAt, latencies, counters) {
  while (Date.now() < stopAt) {
    await oneRequest(latencies, counters);
  }
}

(async () => {
  console.log(`Capacity probe → ${base}${path}`);
  console.log(`concurrency=${concurrency} duration=${durationSec}s`);

  const before = await sampleMetrics();
  if (before) {
    console.log('metrics before:', JSON.stringify({
      queue: before.apiQueue,
      dbPool: before.dbPool,
      redisConnected: before.redisConnected,
      workersEnabled: before.workersEnabled,
      uptimeSeconds: before.uptimeSeconds,
    }));
  }

  const latencies = [];
  const counters = { total: 0, ok: 0, fail: 0, byStatus: {} };
  const stopAt = Date.now() + durationSec * 1000;
  const wallStart = performance.now();
  await Promise.all(
    Array.from({ length: concurrency }, () => worker(stopAt, latencies, counters)),
  );
  const wallMs = performance.now() - wallStart;

  latencies.sort((a, b) => a - b);
  const rps = counters.total / (wallMs / 1000);
  const after = await sampleMetrics();

  console.log('--- results ---');
  console.log(JSON.stringify({
    requests: counters.total,
    ok: counters.ok,
    fail: counters.fail,
    errorRate: counters.total ? +(counters.fail / counters.total).toFixed(4) : 0,
    rps: +rps.toFixed(1),
    latencyMs: {
      p50: latencies.length ? +pct(latencies, 50).toFixed(1) : null,
      p95: latencies.length ? +pct(latencies, 95).toFixed(1) : null,
      p99: latencies.length ? +pct(latencies, 99).toFixed(1) : null,
      max: latencies.length ? +latencies[latencies.length - 1].toFixed(1) : null,
    },
    statusBreakdown: counters.byStatus,
    metricsAfter: after
      ? {
          queue: after.apiQueue,
          dbPool: after.dbPool,
          redisConnected: after.redisConnected,
          workerLag: after.workerLag,
        }
      : null,
  }, null, 2));

  if (counters.fail / Math.max(counters.total, 1) > 0.05) {
    console.error('Probe saw >5% failures — treat current capacity as below this concurrency.');
    process.exit(1);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
