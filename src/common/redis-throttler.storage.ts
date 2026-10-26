import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { RedisService } from './redis.service';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number): Promise<ThrottlerStorageRecord> {
    const redisKey = `throttle:${key}`;
    const hits = Number(await this.redis.client.incr(redisKey));
    if (hits === 1) await this.redis.client.pexpire(redisKey, ttl);
    const remaining = await this.redis.client.pttl(redisKey);
    const blockedKey = `${redisKey}:blocked`;
    const blocked = (await this.redis.client.exists(blockedKey)) === 1;
    if (hits > limit && !blocked && blockDuration > 0) await this.redis.client.set(blockedKey, '1', 'PX', blockDuration);
    return {
      totalHits: hits,
      timeToExpire: Math.max(remaining, 0),
      isBlocked: blocked || hits > limit,
      timeToBlockExpire: blocked ? Math.max(await this.redis.client.pttl(blockedKey), 0) : 0,
    };
  }
}
