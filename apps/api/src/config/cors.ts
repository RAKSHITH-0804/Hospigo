import type { INestApplication } from '@nestjs/common';

/** Split a comma-separated origin list. Undefined or blank means CORS stays off. */
export function parseCorsOrigins(value: string | undefined): string[] | undefined {
  if (value === undefined || value.trim() === '') {
    return undefined;
  }
  const origins = value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  return origins.length > 0 ? origins : undefined;
}

export function applyCors(app: INestApplication, corsOrigin: string | undefined): void {
  const origins = parseCorsOrigins(corsOrigin);
  if (!origins) {
    return;
  }
  app.enableCors({ origin: origins });
}
