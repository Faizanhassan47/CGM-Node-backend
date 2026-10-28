
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
import { WellnessModule } from './wellness/wellness.module';

@Module({
  imports: [
    // Environment configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnvironment,
    }),

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

    // API rate limiting
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 100,
        },
      ],

      // Exempt only the public root GET endpoint.
      // Other routes retain their rate limits.
      skipIf: (context) => {
        const request = context
          .switchToHttp()
          .getRequest<{
            method: string;
            path: string;
          }>();

        return (
          request.method === 'GET' &&
          request.path === '/'
        );
      },
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
    // Global API throttling
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },

    // Global JWT authentication
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule { }
