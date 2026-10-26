import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly log = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL') ?? 'redis://127.0.0.1:6379';
    this.client = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      retryStrategy: (attempt) => Math.min(attempt * 250, 3000),
    });
    this.client.on('error', (error) => this.log.error(`Redis error: ${error.message}`));
  }

  async connect() {
    if (this.client.status === 'wait') await this.client.connect();
    await this.client.ping();
  }

  duplicate() { return this.client.duplicate(); }

  async onApplicationShutdown() {
    if (this.client.status !== 'end') await this.client.quit();
  }
}
