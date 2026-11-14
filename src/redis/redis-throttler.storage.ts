import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis.service';

type ThrottlerStorageRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

/**
 * Shared rate-limit counters for multi-node deployments.
 * Falls back to a local Map when Redis is unavailable.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnModuleInit {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly local = new Map<string, { totalHits: number; expiresAt: number; blockedUntil: number }>();

  constructor(private readonly redis: RedisService) {}

  onModuleInit(): void {
    if (this.redis.isConnected) {
      this.logger.log('Throttler storage: Redis (shared across API nodes)');
    } else {
      this.logger.warn('Throttler storage: in-memory (single node only)');
    }
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redisKey = `cgm:throttle:${throttlerName}:${key}`;
    const client = this.redis.getClient();
    if (client) {
      try {
        const hits = await client.incr(redisKey);
        if (hits === 1) {
          await client.pexpire(redisKey, ttl);
        }
        let timeToExpire = await client.pttl(redisKey);
        if (timeToExpire < 0) {
          await client.pexpire(redisKey, ttl);
          timeToExpire = ttl;
        }

        const blockKey = `${redisKey}:block`;
        let timeToBlockExpire = await client.pttl(blockKey);
        let isBlocked = timeToBlockExpire > 0;
        if (!isBlocked && hits > limit && blockDuration > 0) {
          await client.set(blockKey, '1', 'PX', blockDuration);
          timeToBlockExpire = blockDuration;
          isBlocked = true;
        }

        return {
          totalHits: hits,
          timeToExpire: Math.max(timeToExpire, 0),
          isBlocked,
          timeToBlockExpire: Math.max(timeToBlockExpire, 0),
        };
      } catch (error) {
        this.logger.warn(
          `Redis throttle failed; using local fallback: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return this.incrementLocal(redisKey, ttl, limit, blockDuration);
  }

  private incrementLocal(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
  ): ThrottlerStorageRecord {
    const now = Date.now();
    let record = this.local.get(key);
    if (!record || record.expiresAt <= now) {
      record = { totalHits: 0, expiresAt: now + ttl, blockedUntil: 0 };
    }
    record.totalHits += 1;
    this.local.set(key, record);

    const isBlocked = record.blockedUntil > now;
    if (!isBlocked && record.totalHits > limit && blockDuration > 0) {
      record.blockedUntil = now + blockDuration;
    }

    return {
      totalHits: record.totalHits,
      timeToExpire: Math.max(record.expiresAt - now, 0),
      isBlocked: record.blockedUntil > now,
      timeToBlockExpire: Math.max(record.blockedUntil - now, 0),
    };
  }
}
