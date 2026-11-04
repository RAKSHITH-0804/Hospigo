import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { Test } from '@nestjs/testing';
import request from 'supertest';

const storageRoot = mkdtempSync(path.join(os.tmpdir(), 'hospigo-api-e2e-'));

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  API_PORT: '3000',
  DATABASE_URL: 'postgresql://hospigo:hospigo@127.0.0.1:5432/hospigo',
  REDIS_URL: 'redis://127.0.0.1:6379',
  STORAGE_ROOT_PATH: storageRoot,
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '587',
  SMTP_USER: 'hospigo',
  SMTP_PASSWORD: 'change-me',
  SMTP_FROM: 'noreply@hospigo.indigocomputers.in',
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readService(services: unknown, name: string): ServiceBody {
  if (!isRecord(services)) {
    throw new Error(`Missing services.${name}`);
  }
  const value = services[name];
  if (!isRecord(value)) {
    throw new Error(`services.${name} is missing`);
  }
  if (value['status'] !== 'up' && value['status'] !== 'down') {
    throw new Error(`services.${name}.status must be up or down`);
  }
  if (typeof value['responseTimeMs'] !== 'number') {
    throw new Error(`services.${name}.responseTimeMs must be a number`);
  }
  if (typeof value['checkedAt'] !== 'string') {
    throw new Error(`services.${name}.checkedAt must be a string`);
  }
  if (value['status'] === 'down' && (typeof value['error'] !== 'string' || value['error'] === '')) {
    throw new Error(`services.${name} is down without an error`);
  }

  return {
    status: value['status'],
    responseTimeMs: value['responseTimeMs'],
    checkedAt: value['checkedAt'],
    ...(typeof value['error'] === 'string' ? { error: value['error'] } : {}),
    ...(typeof value['clients'] === 'number' ? { clients: value['clients'] } : {}),
    ...(typeof value['waiting'] === 'number' ? { waiting: value['waiting'] } : {}),
    ...(typeof value['failed'] === 'number' ? { failed: value['failed'] } : {}),
  };
}
