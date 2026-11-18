import Redis from 'ioredis';
import fs from 'fs';

const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
const match = env.match(/^REDIS_URL=(.*)$/m);
if (!match) {
  console.error('REDIS_URL missing');
  process.exit(1);
}
const url = match[1].trim().replace(/^['"]|['"]$/g, '');
const client = new Redis(url, {
  maxRetriesPerRequest: 1,
  connectTimeout: 10_000,
  lazyConnect: true,
  tls: url.startsWith('rediss://') ? {} : undefined,
});
try {
  await client.connect();
  console.log(await client.ping());
  await client.quit();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
