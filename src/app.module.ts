import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { RedisModule } from './common/redis.module';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'], validate: validateEnvironment }),
    RedisModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => databaseConfig(config.getOrThrow('DB_CONNECTION_STRING')),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({ throttlers: [{ ttl: 60_000, limit: 100 }], storage }),
    }),
    AuthModule,
    CgmModule,
    CompatModule,
    FamilyModule,
    WorkersModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
