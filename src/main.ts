
import { createServer, IncomingMessage, ServerResponse } from 'http';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { DataSource } from 'typeorm';

import { AppModule } from './app.module';
import { normalizeDbConnectionString } from './config/database';
import { ensureTablesExist } from './database/schema-initializer';

const listenPort = Number(process.env.PORT ?? process.env.API_PORT ?? '5232');
let nestHandler: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
let startupFailure: string | undefined;

if (process.env.DB_CONNECTION_STRING) {
  const normalized = normalizeDbConnectionString(process.env.DB_CONNECTION_STRING);
  process.env.DB_CONNECTION_STRING = normalized.connectionString;
  if (normalized.remappedFrom && normalized.remappedTo) {
    // Keep this on stdout so Hostinger logs show why the host changed.
    console.warn(
      `[Bootstrap] Remapped MySQL host ${normalized.remappedFrom} -> ${normalized.remappedTo}`,
    );
  }
}

const httpServer = createServer((req, res) => {
  if (nestHandler) {
    nestHandler(req, res);
    return;
  }
  res.statusCode = 503;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(startupFailure ? `Startup failed: ${startupFailure}` : 'Starting');
});
if (process.env.WORKER_ONLY !== 'true' && Number.isInteger(listenPort) && listenPort >= 1 && listenPort <= 65535) {
  httpServer.listen(listenPort, '0.0.0.0');
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  if (process.env.WORKER_ONLY === 'true') {
    const { NestFactory } = await import('@nestjs/core');
    const worker = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
    worker.enableShutdownHooks();
    logger.log('Worker process started. HTTP is off. Set RUN_SCHEDULED_WORKERS=false on the API process.');
    return;
  }

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService);

  const isProduction =
    config.get<string>('NODE_ENV') === 'production';

  // --------------------------------------------
  // 1. Graceful shutdown
  // --------------------------------------------
  app.enableShutdownHooks();

  // --------------------------------------------
  // 2. Reverse proxy configuration
  // --------------------------------------------
  // Only trust a verified proxy IP/subnet or
  // loopback proxy. Do not blindly trust all IPs.

  const trustProxy =
    config.get<string>('TRUST_PROXY') ?? 'false';

  const expressInstance =
    app.getHttpAdapter().getInstance();

  if (trustProxy !== 'false' && trustProxy !== '') {
    if (trustProxy === 'loopback') {
      expressInstance.set('trust proxy', 'loopback');
    } else if (
      trustProxy !== 'true' &&
      trustProxy !== '1'
    ) {
      // Explicit trusted proxy IP or CIDR range
      expressInstance.set('trust proxy', trustProxy);
    } else {
      logger.warn(
        'Unrestricted TRUST_PROXY ignored. ' +
        'Configure a verified proxy address.',
      );
    }
  }

  // --------------------------------------------
  // 3. HTTP security headers
  // --------------------------------------------
  app.use(helmet());

  // --------------------------------------------
  // 4. Global validation
  // --------------------------------------------
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidUnknownValues: true,
    }),
  );

  // --------------------------------------------
  // 5. CORS configuration
  // --------------------------------------------
  const origins = (
    config.get<string>('CORS_ALLOWED_ORIGINS') ?? ''
  )
    .split(';')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins.length > 0 ? origins : false,
  });

  // --------------------------------------------
  // 6. Swagger API documentation
  // --------------------------------------------
  // Disabled by default in production.
  // Enable explicitly if needed.

  const swaggerEnabled =
    config.get<string>('ENABLE_SWAGGER') === 'true' ||
    !isProduction;

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CGM Platform API')
      .setDescription('AIMA CGM Backend API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();

    const swaggerDocument = SwaggerModule.createDocument(
      app,
      swaggerConfig,
    );

    SwaggerModule.setup(
      'swagger',
      app,
      swaggerDocument,
    );

    logger.log('Swagger documentation enabled');
  }

  // --------------------------------------------
  // 7. Database initialization
  // --------------------------------------------
  const dataSource = app.get(DataSource);

  if (!dataSource.isInitialized) {
    throw new Error(
      'Database connection is not initialized',
    );
  }

  const port = listenPort;

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('Invalid PORT or API_PORT configuration');
  }

  nestHandler = app.getHttpAdapter().getInstance();
  await app.init();

  const [databaseIdentity] = await dataSource.query(
    'SELECT DATABASE() AS ActiveDatabase',
  );
  const activeDatabase = String(databaseIdentity?.ActiveDatabase ?? '');
  const expectedDatabase = config.get<string>('CGM_STAGING_DATABASE_NAME');
  if (config.get<string>('CGM_STAGING_DATABASE') === 'true' && expectedDatabase && activeDatabase !== expectedDatabase) {
    throw new Error(`Staging database mismatch: connected to ${activeDatabase}, expected ${expectedDatabase}`);
  }

  await ensureTablesExist(dataSource);

  logger.log('Database initialization completed');

  logger.log('========================================');
  logger.log('AIMA CGM Backend Started Successfully');
  logger.log(`Environment: ${isProduction ? 'Production' : 'Development'}`);
  logger.log(`Port: ${port}`);
  logger.log(`Database: Connected (${activeDatabase})`);
  logger.log(`Swagger: ${swaggerEnabled ? 'Enabled' : 'Disabled'}`);
  logger.log('========================================');
}

// --------------------------------------------
// 10. Startup error handling
// --------------------------------------------
bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');
  const message =
    error instanceof Error ? error.message : String(error);

  startupFailure =
    process.env.NODE_ENV === 'production'
      ? 'Service unavailable'
      : message;
  logger.error(
    'Application startup failed',
    error instanceof Error ? error.stack : String(error),
  );

  // Exit so the host restarts after env/DB fixes instead of serving "Starting" forever.
  setTimeout(() => process.exit(1), 250).unref?.();
  process.exitCode = 1;
});
