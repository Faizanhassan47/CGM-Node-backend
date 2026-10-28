
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { DataSource } from 'typeorm';

import { AppModule } from './app.module';
import { ensureTablesExist } from './database/schema-initializer';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

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

  // Preserve current database initialization
  // behavior until versioned migrations are
  // implemented.
  await ensureTablesExist(dataSource);

  logger.log('Database initialization completed');

  // --------------------------------------------
  // 8. Server startup
  // --------------------------------------------
  const port =
    Number(config.get<string>('API_PORT') ?? '5232');

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error('Invalid API_PORT configuration');
  }

  await app.listen(port, '0.0.0.0');

  // --------------------------------------------
  // 9. Production logging
  // --------------------------------------------
  logger.log('========================================');
  logger.log('AIMA CGM Backend Started Successfully');
  logger.log(`Environment: ${isProduction ? 'Production' : 'Development'}`);
  logger.log(`Port: ${port}`);
  logger.log('Database: Connected');
  logger.log(`Swagger: ${swaggerEnabled ? 'Enabled' : 'Disabled'}`);
  logger.log('========================================');
}

// --------------------------------------------
// 10. Startup error handling
// --------------------------------------------
bootstrap().catch((error: unknown) => {
  const logger = new Logger('Bootstrap');

  logger.error(
    'Application startup failed',
    error instanceof Error ? error.stack : String(error),
  );

  process.exitCode = 1;
});
