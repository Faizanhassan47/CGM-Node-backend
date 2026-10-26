import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { createAdapter } from '@socket.io/redis-adapter';
import { RedisService } from './common/redis.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const config = app.get(ConfigService);
  const redis = app.get(RedisService);
  await redis.connect();
  const redisAdapter = new RedisIoAdapter(app, redis);
  await redisAdapter.connectToRedis();
  app.useWebSocketAdapter(redisAdapter);
  app.use(helmet());
  const bodyLimit = `${config.get<number>('HTTP_BODY_LIMIT_MB') ?? 10}mb`;
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  const timeout = config.get<number>('HTTP_REQUEST_TIMEOUT_MS') ?? 30_000;
  app.use((_req: unknown, res: { setTimeout: (ms: number) => void }, next: () => void) => {
    res.setTimeout(timeout);
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  const origins = (config.get<string>('CORS_ALLOWED_ORIGINS') ?? '').split(';').filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : false });
  const swagger = new DocumentBuilder().setTitle('CGM Platform API').setVersion('1').addBearerAuth().build();
  SwaggerModule.setup('swagger', app, SwaggerModule.createDocument(app, swagger));
  
  const { ensureTablesExist } = await import('./database/schema-initializer');
  const { DataSource } = await import('typeorm');
  await ensureTablesExist(app.get(DataSource));

  app.enableShutdownHooks();
  const port = config.get<number>('API_PORT') ?? 5232;
  await app.listen(port, '0.0.0.0');
  
  const dbString = config.get<string>('DB_CONNECTION_STRING') || '';
  const isLocal = dbString.toLowerCase().includes('trusted_connection') || dbString.toLowerCase().includes('dell');
  
  Logger.log(`=================================================`, 'Bootstrap');
  Logger.log(`🚀 API is running on port: ${port}`, 'Bootstrap');
  Logger.log(`🗄️ Database: ${isLocal ? 'LOCAL MS SQL' : 'LIVE MySQL'}`, 'Bootstrap');
  Logger.log(`=================================================`, 'Bootstrap');
}

void bootstrap();
