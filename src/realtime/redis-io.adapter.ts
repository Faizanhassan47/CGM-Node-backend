import { INestApplication, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { ServerOptions } from 'socket.io';
import { RedisService } from '../redis/redis.service';

/**
 * Socket.IO adapter that fans events across API nodes via Redis pub/sub.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly log = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplication,
    private readonly redis: RedisService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<boolean> {
    const pair = this.redis.createPubSubPair();
    if (!pair) {
      this.log.warn('Socket.IO Redis adapter skipped (Redis unavailable)');
      return false;
    }
    const { pub, sub } = pair;
    await Promise.all([
      pub.status === 'wait' ? pub.connect() : Promise.resolve(),
      sub.status === 'wait' ? sub.connect() : Promise.resolve(),
    ]);
    this.adapterConstructor = createAdapter(pub, sub);
    this.log.log('Socket.IO Redis adapter enabled for multi-node fan-out');
    return true;
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
