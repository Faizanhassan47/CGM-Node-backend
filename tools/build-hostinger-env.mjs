import fs from 'fs';

const text = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const map = {};
for (const line of text.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const index = trimmed.indexOf('=');
  if (index < 0) continue;
  const key = trimmed.slice(0, index).trim();
  let value = trimmed.slice(index + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) continue;
  map[key] = value;
}

// Single Hostinger Node process: keep workers on the API until a second app exists.
map.RUN_SCHEDULED_WORKERS = 'true';
map.INSTANCE_ID = 'api-1';
map.REDIS_ENABLED = 'true';
map.REDIS_REQUIRED = 'false';
map.API_QUEUE_LIGHT_LIMIT = map.API_QUEUE_LIGHT_LIMIT || '16';
map.API_QUEUE_INGEST_LIMIT = map.API_QUEUE_INGEST_LIMIT || '4';
map.API_QUEUE_HEAVY_LIMIT = map.API_QUEUE_HEAVY_LIMIT || '3';
map.API_QUEUE_AI_LIMIT = map.API_QUEUE_AI_LIMIT || '2';
map.API_QUEUE_AI_TIMEOUT_MS = map.API_QUEUE_AI_TIMEOUT_MS || '45000';
map.DB_POOL_LIMIT = map.DB_POOL_LIMIT || '25';
map.TRUST_PROXY = '1';

const envVars = Object.entries(map).map(([key, value]) => ({ key, value }));
fs.writeFileSync(new URL('./hostinger-env.json', import.meta.url), JSON.stringify(envVars, null, 2));
console.log(`wrote ${envVars.length} keys`);
