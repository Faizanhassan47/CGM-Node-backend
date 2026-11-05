import { Global, Module } from '@nestjs/common';
import { ApiQueueService } from './api-queue.service';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService, ApiQueueService],
  exports: [RedisService, ApiQueueService],
})
export class RedisModule {}
