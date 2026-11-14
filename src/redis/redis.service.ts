import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client?: Redis;
  private readonly secondary = new Set<Redis>();

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
    const url = this.config.get<string>('REDIS_URL');
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

    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_ENABLED=true but REDIS_URL is missing.');
      return;
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
    }
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
    for (const client of this.secondary) {
      await client.quit().catch(() => undefined);
    }
    this.secondary.clear();
    if (this.client) await this.client.quit().catch(() => undefined);
  }

  private createClient(url: string): Redis {
    const client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    client.on('error', (error) => {
      this.logger.warn(
        `Redis connection error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return client;
  }
}
