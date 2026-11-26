
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppController } from './app.controller';
import { databaseConfig } from './config/database';
import { validateEnvironment } from './config/environment';
import { HealthController } from './health/health.controller';

import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CgmModule } from './cgm/cgm.module';
import { CompatModule } from './compat/compat.module';
import { FamilyModule } from './family/family.module';
import { WorkersModule } from './workers/workers.module';
import { WellnessModule } from './wellness/wellness.module';
import { AppThrottlerGuard } from './common/guards/app-throttler.guard';
import { ApiMetricsInterceptor } from './common/interceptors/api-metrics.interceptor';
import { ApiQueueInterceptor } from './redis/api-queue.interceptor';
import { RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './redis/redis-throttler.storage';

function intEnv(config: ConfigService, key: string, fallback: number, min: number, max: number): number {
  const raw = Number(config.get<string | number>(key) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

const selectedEnvFile = process.env.DOTENV_CONFIG_PATH;

@Module({
  imports: [
    // Environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: selectedEnvFile ? [selectedEnvFile] : ['.env.local', '.env'],
      validate: validateEnvironment,
    }),

    // Shared Redis before throttler so rate limits can be cross-node.
    RedisModule,

    // Database configuration
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        databaseConfig(
          config.getOrThrow<string>('DB_CONNECTION_STRING'),
        ),
    }),

    // Scheduled background tasks
    ScheduleModule.forRoot(),

    // API rate limiting (Redis-backed when REDIS is connected)
    ThrottlerModule.forRootAsync({
      imports: [RedisModule],
      inject: [ConfigService, RedisThrottlerStorage],
      useFactory: (config: ConfigService, storage: RedisThrottlerStorage) => ({
        throttlers: [
          {
            name: 'short',
            ttl: intEnv(config, 'THROTTLE_SHORT_TTL_MS', 1_000, 200, 10_000),
            limit: intEnv(config, 'THROTTLE_SHORT_LIMIT', 25, 5, 200),
          },
          {
            name: 'default',
            ttl: intEnv(config, 'THROTTLE_TTL_MS', 60_000, 5_000, 600_000),
            limit: intEnv(config, 'THROTTLE_LIMIT', 120, 20, 2_000),
          },
        ],
        storage,
        errorMessage: 'Too many requests. Try again shortly.',
        skipIf: (context) => {
          const request = context.switchToHttp().getRequest<{
            method: string;
            path: string;
          }>();
          if (request.method !== 'GET') return false;
          const path = request.path ?? '';
          return (
            path === '/' ||
            path === '/health' ||
            path.startsWith('/health/') ||
            path === '/metrics'
          );
        },
      }),
    }),

    // Application modules
    AuthModule,
    CgmModule,
    CompatModule,
    FamilyModule,
    WorkersModule,
    WellnessModule,
  ],

  controllers: [
    AppController,
    HealthController,
  ],

  providers: [
    // Rate-limit before JWT so invalid-token floods still consume quota.
    {
      provide: APP_GUARD,
      useClass: AppThrottlerGuard,
    },

    // Global JWT authentication
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },

    // Low-overhead request timing; never logs request bodies or credentials.
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiQueueInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ApiMetricsInterceptor,
    },
  ],
})
export class AppModule { }
