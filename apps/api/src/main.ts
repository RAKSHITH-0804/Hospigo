import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { applyCors } from './config/cors';
import { assertNoTestTenantsInProduction } from './config/production-seed-guard';
import { setupSwagger } from './setup-swagger';
import type { ApiEnv } from './config/env';
import { behindMessage, checkMigrations } from './database/migrations-check';
import { HospigoValidationPipe } from './modules/patients/patient-dto-validation';

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

  // the database must have every migration of this code: say so loudly (development refuses to start)
  const migrations = await checkMigrations(config.get('DATABASE_URL_OWNER', { infer: true }));
  if (migrations.status === 'behind') {
    console.error(behindMessage(migrations.missing));
    if (nodeEnv === 'development') {
      process.exit(1);
    }
  }

  if (auth.trustedProxy === 'none') {
    app.set('trust proxy', false);
  } else {
    app.set('trust proxy', auth.trustedProxy);
  }

  app.use(helmet());
  app.useBodyParser('json', { limit: auth.requestBodyLimitBytes });
  app.useBodyParser('urlencoded', { limit: auth.requestBodyLimitBytes, extended: true });

  app.useGlobalPipes(new HospigoValidationPipe());

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
