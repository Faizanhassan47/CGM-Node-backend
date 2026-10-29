require('dotenv').config();

const Redis = require('ioredis');

async function main() {
  const url = process.env.REDIS_URL;

  if (!url || !url.startsWith('rediss://')) {
    throw new Error('A TLS-enabled REDIS_URL is required in .env.');
  }

  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 5000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);

  try {
    await client.connect();

    const ping = await client.ping();
    console.log(`Upstash Redis connection: ${ping}`);

    const key = `aima:connection-test:${Date.now()}`;
    await client.set(key, 'connected', 'EX', 30);
    const value = await client.get(key);

    console.log(
      `Redis read/write test: ${value === 'connected' ? 'PASSED' : 'FAILED'}`,
    );

    await client.del(key);
  } finally {
    client.disconnect();
  }
}

main().catch((error) => {
  console.error('Redis test failed:', error.message);
  process.exitCode = 1;
});
