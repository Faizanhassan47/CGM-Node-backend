import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Public } from '../auth/public.decorator';
import { normalizeSql } from '../common/sql-helper';
import { ApiQueueService } from '../redis/api-queue.service';
import { RedisService } from '../redis/redis.service';
import { WorkerMetricsService } from '../workers/worker-metrics.service';

@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly queue: ApiQueueService,
    private readonly config: ConfigService,
    private readonly workerMetrics: WorkerMetricsService,
  ) {}

  private q(sql: string, params?: unknown[]) {
    return this.dataSource.query(normalizeSql(sql, this.dataSource), params);
  }

  private instanceId(): string {
    return this.config.get<string>('INSTANCE_ID') ?? process.env.HOSTNAME ?? 'api';
  }

  @Get('health')
  @Public()
  async health() {
    return this.readiness();
  }

  /** Hostinger / LB liveness probe — use this URL (always-on check). */
  @Get('health/live')
  @Public()
  live() {
    return {
      status: 'Healthy',
      instanceId: this.instanceId(),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('health/ready')
  @Public()
  async readiness() {
    let database: 'Healthy' | 'Unhealthy' = 'Healthy';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      database = 'Unhealthy';
    }

    const redisRequired = this.config.get<string>('REDIS_REQUIRED') === 'true';
    const redisOk = !this.redis.enabled || (await this.redis.ping());
    if (database !== 'Healthy' || (redisRequired && !redisOk)) {
      throw new ServiceUnavailableException({
        status: 'Unhealthy',
        database,
        redis: redisOk ? 'Healthy' : 'Unhealthy',
        timestamp: new Date().toISOString(),
      });
    }

    return {
      status: 'Healthy',
      database,
      redis: this.redis.enabled ? (redisOk ? 'Healthy' : 'Unhealthy') : 'Disabled',
      instanceId: this.instanceId(),
      workersEnabled: this.config.get<string>('RUN_SCHEDULED_WORKERS') !== 'false',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('metrics')
  @Public()
  async metrics() {
    const pool = this.readPoolStats();
    const workerLag = await this.readWorkerLag();
    return {
      uptimeSeconds: Math.floor(process.uptime()),
      instanceId: this.instanceId(),
      apiQueue: this.queue.snapshot(),
      apiQueueDepth: this.queue.depth,
      dbPool: pool,
      workerLag,
      workerTicks: this.workerMetrics.snapshot(),
      redisConnected: this.redis.isConnected,
      workersEnabled: this.config.get<string>('RUN_SCHEDULED_WORKERS') !== 'false',
      timestamp: new Date().toISOString(),
    };
  }

  private readPoolStats(): Record<string, number | null> {
    try {
      const pool = (this.dataSource.driver as { pool?: any }).pool;
      if (!pool) {
        return { total: null, free: null, queue: null, limit: null };
      }
      const total = Number(pool._allConnections?.length ?? pool.totalCount ?? NaN);
      const free = Number(pool._freeConnections?.length ?? pool.idleCount ?? NaN);
      const queue = Number(pool._connectionQueue?.length ?? pool.waitingCount ?? NaN);
      const limit = Number(pool.config?.connectionLimit ?? pool.options?.connectionLimit ?? 20);
      return {
        total: Number.isFinite(total) ? total : null,
        free: Number.isFinite(free) ? free : null,
        queue: Number.isFinite(queue) ? queue : null,
        limit: Number.isFinite(limit) ? limit : null,
      };
    } catch {
      return { total: null, free: null, queue: null, limit: null };
    }
  }

  private async readWorkerLag(): Promise<{
    alertPending: number;
    alertFailed: number;
    alertOldestPendingAgeSeconds: number | null;
    dailySummaryPending: number;
  }> {
    try {
      const [pendingRow] = await this.q(
        'SELECT COUNT(*) AS count, MIN(CreatedAt) AS oldest FROM AlertQueue WHERE Status="Pending"',
      );
      const [failedRow] = await this.q(
        'SELECT COUNT(*) AS count FROM AlertQueue WHERE Status="Failed"',
      );
      const [summaryRow] = await this.q(
        'SELECT COUNT(*) AS count FROM DailySummaryJobs WHERE Status IN ("Pending","Failed")',
      );
      const oldest = pendingRow?.oldest ?? pendingRow?.Oldest ?? null;
      const ageSeconds =
        oldest != null
          ? Math.max(0, Math.floor((Date.now() - new Date(oldest).getTime()) / 1000))
          : null;
      return {
        alertPending: Number(pendingRow?.count ?? pendingRow?.COUNT ?? 0),
        alertFailed: Number(failedRow?.count ?? failedRow?.COUNT ?? 0),
        alertOldestPendingAgeSeconds: ageSeconds,
        dailySummaryPending: Number(summaryRow?.count ?? summaryRow?.COUNT ?? 0),
      };
    } catch {
      return {
        alertPending: -1,
        alertFailed: -1,
        alertOldestPendingAgeSeconds: null,
        dailySummaryPending: -1,
      };
    }
  }
}
