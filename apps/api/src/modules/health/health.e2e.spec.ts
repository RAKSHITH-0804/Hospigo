import 'reflect-metadata';
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Test } from '@nestjs/testing';
import request from 'supertest';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'hospigo-api-e2e-'));

function requireAppTestDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_TEST || process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL_TEST (or DATABASE_URL) is required for health e2e');
  }
  const dbName = new URL(url).pathname.replace(/^\//, '');
  if (dbName !== 'hospigo_test') {
    throw new Error(
      `Refusing to run health e2e against database "${dbName}". Expected hospigo_test.`,
    );
  }
  return url;
}

const appDatabaseUrl = requireAppTestDatabaseUrl();

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  // App role only — never fall back to DATABASE_URL_OWNER.
  DATABASE_URL: appDatabaseUrl,
  REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  STORAGE_ROOT_PATH: storageRoot,
  SMTP_HOST: process.env.SMTP_HOST || '127.0.0.1',
  SMTP_PORT: process.env.SMTP_PORT || '587',
  SMTP_USER: process.env.SMTP_USER || 'hospigo',
  SMTP_PASSWORD: process.env.SMTP_PASSWORD || 'change-me',
  SMTP_FROM: process.env.SMTP_FROM || 'noreply@hospigo.indigocomputers.in',
  PATIENT_SEARCH_MAX_PAGE_SIZE: process.env.PATIENT_SEARCH_MAX_PAGE_SIZE || '50',
  JWT_HOSPITAL_ACCESS_SECRET:
    process.env.JWT_HOSPITAL_ACCESS_SECRET || 'test-hospital-access-secret-min-32-chars!!',
  JWT_HQ_ACCESS_SECRET:
    process.env.JWT_HQ_ACCESS_SECRET || 'test-hq-access-secret-min-32-characters!!',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] = value;
}

interface ServiceBody {
  status: string;
  responseTimeMs: number;
  checkedAt: string;
  error?: string;
  clients?: number;
  waiting?: number;
  failed?: number;
}

describe('Health endpoints', () => {
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const { AppModule } = await import('../../app.module');
    const { setupSwagger } = await import('../../setup-swagger');
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    setupSwagger(app);
    await app.listen(0);
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('GET /health returns ok without checking dependencies', async () => {
    const started = Date.now();
    const response = await request(server).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('GET /health/details reports each service without failing the request', async () => {
    const started = Date.now();
    const response = await request(server).get('/health/details');
    const elapsed = Date.now() - started;

    expect(response.status).toBe(200);
    expect(elapsed).toBeLessThan(8000);

    const body: unknown = response.body;
    expect(isRecord(body)).toBe(true);
    if (!isRecord(body) || !isRecord(body['services'])) {
      throw new Error('Health details response has an unexpected shape');
    }

    expect(['ok', 'degraded']).toContain(body['status']);
    expect(typeof body['checkedAt']).toBe('string');

    const names = ['postgres', 'redis', 'storage', 'websocket', 'queue'] as const;
    const services = names.map((name) => readService(body['services'], name));
    expect(body['status']).toBe(
      services.every((service) => service.status === 'up') ? 'ok' : 'degraded',
    );

    const storage = readService(body['services'], 'storage');
    expect(storage.status).toBe('up');

    const websocket = readService(body['services'], 'websocket');
    if (websocket.status === 'up') {
      expect(typeof websocket.clients).toBe('number');
    }

    const queue = readService(body['services'], 'queue');
    if (queue.status === 'up') {
      expect(typeof queue.waiting).toBe('number');
      expect(typeof queue.failed).toBe('number');
    }
  });

  it('GET /docs serves Swagger UI', async () => {
    const response = await request(server).get('/docs').redirects(1);

    expect(response.status).toBe(200);
    expect(String(response.text)).toMatch(/swagger/i);

    const spec = await request(server).get('/docs-json');
    expect(spec.status).toBe(200);
    expect(spec.body).toMatchObject({
      info: { title: 'Hospigo API' },
    });
  });
});

function isRecord(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readService(services: unknown, name: string): ServiceBody {
  if (!isRecord(services)) {
    throw new Error(`Missing services.${name}`);
  }
  const value = (services as Record<string, unknown>)[name];
  if (!isRecord(value)) {
    throw new Error(`services.${name} is missing`);
  }
  const record = value as Record<string, unknown>;
  if (record['status'] !== 'up' && record['status'] !== 'down') {
    throw new Error(`services.${name}.status must be up or down`);
  }
  if (typeof record['responseTimeMs'] !== 'number') {
    throw new Error(`services.${name}.responseTimeMs must be a number`);
  }
  if (typeof record['checkedAt'] !== 'string') {
    throw new Error(`services.${name}.checkedAt must be a string`);
  }
  if (
    record['status'] === 'down' &&
    (typeof record['error'] !== 'string' || record['error'] === '')
  ) {
    throw new Error(`services.${name} is down without an error`);
  }

  return {
    status: record['status'] as string,
    responseTimeMs: record['responseTimeMs'] as number,
    checkedAt: record['checkedAt'] as string,
    ...(typeof record['error'] === 'string' ? { error: record['error'] } : {}),
    ...(typeof record['clients'] === 'number' ? { clients: record['clients'] } : {}),
    ...(typeof record['waiting'] === 'number' ? { waiting: record['waiting'] } : {}),
    ...(typeof record['failed'] === 'number' ? { failed: record['failed'] } : {}),
  };
}
