import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { applyCors } from './config/cors';
import { assertNoTestTenantsInProduction } from './config/production-seed-guard';
import { setupSwagger } from './setup-swagger';
import type { ApiEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const config = app.get(ConfigService<ApiEnv, true>);
  const auth = config.getOrThrow('auth', { infer: true });
  const nodeEnv = config.getOrThrow('NODE_ENV', { infer: true });

  await assertNoTestTenantsInProduction(
    nodeEnv,
    config.getOrThrow('DATABASE_URL_OWNER', { infer: true }),
  );

  if (auth.trustedProxy === 'none') {
    app.set('trust proxy', false);
  } else {
    app.set('trust proxy', auth.trustedProxy);
  }

  app.use(helmet());
  app.useBodyParser('json', { limit: auth.requestBodyLimitBytes });
  app.useBodyParser('urlencoded', { limit: auth.requestBodyLimitBytes, extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (nodeEnv !== 'production') {
    setupSwagger(app);
  }

  applyCors(app, config.get('CORS_ORIGIN', { infer: true }));
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
