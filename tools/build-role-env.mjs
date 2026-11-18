import fs from 'fs';

const role = process.argv[2];
if (!['api', 'api2', 'worker'].includes(role)) {
  console.error('Usage: node tools/build-role-env.mjs <api|api2|worker>');
  process.exit(2);
}

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

map.NODE_ENV = 'production';
map.REDIS_ENABLED = 'true';
map.TRUST_PROXY = '1';
map.API_QUEUE_LIGHT_LIMIT = map.API_QUEUE_LIGHT_LIMIT || '16';
map.API_QUEUE_HEAVY_LIMIT = map.API_QUEUE_HEAVY_LIMIT || '8';
map.DB_POOL_LIMIT = map.DB_POOL_LIMIT || '25';

if (role === 'worker') {
  map.INSTANCE_ID = 'worker-1';
  map.RUN_SCHEDULED_WORKERS = 'true';
  map.WORKER_ONLY = 'true';
  map.REDIS_REQUIRED = 'false';
} else if (role === 'api2') {
  map.INSTANCE_ID = 'api-2';
  map.RUN_SCHEDULED_WORKERS = 'false';
  map.WORKER_ONLY = 'false';
  map.REDIS_REQUIRED = 'true';
} else {
  map.INSTANCE_ID = 'api-1';
  map.RUN_SCHEDULED_WORKERS = 'false';
  map.WORKER_ONLY = 'false';
  map.REDIS_REQUIRED = 'true';
}

const envVars = Object.entries(map).map(([key, value]) => ({ key, value }));
const out = new URL(`./hostinger-env-${role}.json`, import.meta.url);
fs.writeFileSync(out, JSON.stringify(envVars, null, 2));
console.log(`wrote ${envVars.length} keys for ${role}`);
