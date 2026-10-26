import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import Redis from 'ioredis';
import { RedisService } from '../common/redis.service';

export class RedisIoAdapter extends IoAdapter {
  private subscriber!: Redis;

  constructor(
    app: INestApplicationContext,
    private readonly redis: RedisService,
  ) {
    super(app);
  }

  async connectToRedis() {
    this.subscriber = this.redis.duplicate();
    await this.subscriber.connect();
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    server.adapter(createAdapter(this.redis.client, this.subscriber));
    return server;
  }
}
