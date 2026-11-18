import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client?: Redis;
  private readonly secondary = new Set<Redis>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get<string>('REDIS_ENABLED') === 'true';
  }

  get isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  getClient(): Redis | undefined {
    return this.isConnected ? this.client : undefined;
  }

  /** Dedicated pub/sub clients for Socket.IO adapter (must not share with command client). */
  createPubSubPair(): { pub: Redis; sub: Redis } | undefined {
    const url = this.redisUrl();
    if (!this.enabled || !url || !this.isConnected) return undefined;
    const pub = this.createClient(url);
    const sub = this.createClient(url);
    this.secondary.add(pub);
    this.secondary.add(sub);
    return { pub, sub };
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Redis disabled; using database-backed queues and local throttling.');
      return;
    }
    await this.connectWithRetry(true);
  }

  async lock(key: string, ttlSeconds: number): Promise<boolean> {
    if (!this.client || !this.isConnected) return true;
    try {
      const result = await this.client.set(key, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      return true;
    }
  }

  async ping(): Promise<boolean> {
    if (!this.client || !this.isConnected) return false;
    try {
      return (await this.client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const client of this.secondary) {
      await client.quit().catch(() => undefined);
    }
    this.secondary.clear();
    if (this.client) await this.client.quit().catch(() => undefined);
  }

  private redisUrl(): string | undefined {
    const raw = this.config.get<string>('REDIS_URL');
    return raw?.trim().replace(/^['"]|['"]$/g, '') || undefined;
  }

  private async connectWithRetry(initial: boolean): Promise<void> {
    if (this.stopped) return;
    const url = this.redisUrl();
    if (!url) {
      this.logger.warn('REDIS_ENABLED=true but REDIS_URL is missing.');
      return;
    }

    if (this.client) {
      await this.client.quit().catch(() => undefined);
      this.client = undefined;
    }

    this.client = this.createClient(url);
    try {
      if (this.client.status === 'wait') {
        await this.client.connect();
      }
      await this.client.ping();
      this.logger.log('Redis connection verified (shared locks, throttling, WS fan-out).');
    } catch (error) {
      this.logger.error(
        `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.client.quit().catch(() => undefined);
      this.client = undefined;
      // Keep retrying so Hostinger cold-start / brief Upstash blips recover without redeploy.
      if (!this.stopped) {
        const delay = initial ? 5_000 : 15_000;
        this.reconnectTimer = setTimeout(() => {
          void this.connectWithRetry(false);
        }, delay);
        this.reconnectTimer.unref?.();
      }
    }
  }

  private createClient(url: string): Redis {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 8_000,
      // Upstash / dual-stack hosts: let Node pick IPv4 when IPv6 fails.
      family: 0,
      tls: url.startsWith('rediss://') ? {} : undefined,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    client.on('error', (error) => {
      this.logger.warn(
        `Redis connection error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    client.on('ready', () => {
      this.logger.log('Redis ready');
    });
    client.on('end', () => {
      if (this.stopped || this.reconnectTimer) return;
      this.logger.warn('Redis disconnected; scheduling reconnect');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = undefined;
        void this.connectWithRetry(false);
      }, 10_000);
      this.reconnectTimer.unref?.();
    });
    return client;
  }
}
