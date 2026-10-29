import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client?: Redis;

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.config.get<string>('REDIS_ENABLED') === 'true';
  }

  get isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.log('Redis disabled; using database-backed queues.');
      return;
    }

    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn('REDIS_ENABLED=true but REDIS_URL is missing.');
      return;
    }

    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
      retryStrategy: () => null,
    });
    this.client.on('error', (error) => {
      this.logger.warn(
        `Redis connection error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    try {
      await this.client.connect();
      await this.client.ping();
      this.logger.log('Redis connection verified.');
    } catch (error) {
      this.logger.error(
        `Redis connection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.client.quit().catch(() => undefined);
      this.client = undefined;
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
    if (this.client) await this.client.quit().catch(() => undefined);
  }
}
