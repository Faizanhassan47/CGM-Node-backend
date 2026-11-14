import { Global, Module } from '@nestjs/common';
import { ApiQueueService } from './api-queue.service';
import { RedisThrottlerStorage } from './redis-throttler.storage';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, ApiQueueService, RedisThrottlerStorage],
  exports: [RedisService, ApiQueueService, RedisThrottlerStorage],
})
export class RedisModule {}
