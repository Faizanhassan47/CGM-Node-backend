#!/usr/bin/env node
/**
 * Staging/prod smoke: liveness + readiness must be Healthy before promote.
 * Usage: node scripts/smoke-test.js https://api.example.com
 */
const base = (process.argv[2] || process.env.SMOKE_BASE_URL || '').replace(/\/$/, '');
if (!base) {
  console.error('Usage: node scripts/smoke-test.js <baseUrl>');
  process.exit(2);
}

async function get(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

(async () => {
  const live = await get('/health/live');
  if (live.status !== 200 || live.body?.status !== 'Healthy') {
    console.error('FAIL /health/live', live);
    process.exit(1);
  }
  console.log('OK /health/live', live.body.instanceId ?? '');

  const ready = await get('/health/ready');
  if (ready.status !== 200 || ready.body?.status !== 'Healthy') {
    console.error('FAIL /health/ready', ready);
    process.exit(1);
  }
  console.log('OK /health/ready db=', ready.body.database, 'redis=', ready.body.redis);

  const metrics = await get('/metrics');
  if (metrics.status !== 200) {
    console.error('FAIL /metrics', metrics);
    process.exit(1);
  }
  console.log(
    'OK /metrics queueDepth=',
    metrics.body.apiQueueDepth,
    'workerLag=',
    metrics.body.workerLag?.alertOldestPendingAgeSeconds ?? 'n/a',
  );
  console.log('Smoke passed against', base);
})().catch((error) => {
  console.error('Smoke failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
