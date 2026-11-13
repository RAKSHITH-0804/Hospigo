import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { applyCors } from './cors';

@Controller('probe')
class ProbeController {
  @Get()
  ok(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

describe('CORS', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('sends the allow-origin header for a listed origin and omits it for any other origin', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ProbeModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    applyCors(app, 'http://127.0.0.1:3001, http://localhost:3001');
    await app.init();
    const server = app.getHttpServer();

    const allowed = await request(server).get('/probe').set('Origin', 'http://127.0.0.1:3001');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://127.0.0.1:3001');

    const denied = await request(server).get('/probe').set('Origin', 'http://other.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
