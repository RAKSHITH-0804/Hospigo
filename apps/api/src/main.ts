import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { applyCors } from './config/cors';
import { setupSwagger } from './setup-swagger';
import type { ApiEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  setupSwagger(app);

  const config = app.get(ConfigService<ApiEnv, true>);
  applyCors(app, config.get('CORS_ORIGIN', { infer: true }));
  const port = config.get('API_PORT', { infer: true });
  await app.listen(port);
}

bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
