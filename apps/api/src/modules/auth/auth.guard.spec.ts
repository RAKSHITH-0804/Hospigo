import 'reflect-metadata';
import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { getContext } from '../../common/request-context';
import { loadAuthConfig } from './auth.config';
import { AuthGuard } from './auth.guard';
import { Public } from './public.decorator';
import { PasswordService } from './password.service';
import { TokenKinds } from './token-kinds.decorator';
import { TokenService } from './token.service';

const HOSPITAL = 'test-hospital-access-secret-min-32-chars!!';
const HQ = 'test-hq-access-secret-min-32-characters!!';

@Controller('auth-probe')
@UseGuards(AuthGuard)
class AuthProbeController {
  @Get('hospital')
  @TokenKinds('HOSPITAL')
  hospital(): { ok: true; kind: string | undefined; tenantId: string | null } {
    const ctx = getContext();
    return { ok: true, kind: ctx?.kind, tenantId: ctx?.tenantId ?? null };
  }

  @Get('hq')
  @TokenKinds('HQ')
  hq(): { ok: true; kind: string | undefined } {
    const ctx = getContext();
    return { ok: true, kind: ctx?.kind };
  }

  @Get('change-password')
  @TokenKinds('CHANGE_PASSWORD_HOSPITAL')
  changePassword(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Get('public')
  open(): { ok: true } {
    return { ok: true };
  }
}

describe('AuthGuard', () => {
  let app: INestApplication;
  let tokens: TokenService;

  beforeAll(async () => {
    const auth = loadAuthConfig({
      JWT_HOSPITAL_ACCESS_SECRET: HOSPITAL,
      JWT_HQ_ACCESS_SECRET: HQ,
    });
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'auth') return auth;
        throw new Error(`unexpected ${key}`);
      },
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthProbeController],
      providers: [
        { provide: ConfigService, useValue: config },
        PasswordService,
        TokenService,
        AuthGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets request context from hospital token and refuses HQ on hospital route', async () => {
    const hospital = tokens.signHospitalAccess({
      tenantId: 'tenant-1',
      userId: 'user-1',
      branchId: 'branch-1',
    });
    const hq = tokens.signHqAccess({ userId: 'hq-1' });

    const ok = await request(app.getHttpServer())
      .get('/auth-probe/hospital')
      .set('Authorization', `Bearer ${hospital}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true, kind: 'HOSPITAL', tenantId: 'tenant-1' });

    const denied = await request(app.getHttpServer())
      .get('/auth-probe/hospital')
      .set('Authorization', `Bearer ${hq}`);
    expect(denied.status).toBe(401);

    const reverse = await request(app.getHttpServer())
      .get('/auth-probe/hq')
      .set('Authorization', `Bearer ${hospital}`);
    expect(reverse.status).toBe(401);
  });

  it('accepts CHANGE_PASSWORD only where allowed', async () => {
    const change = tokens.signHospitalAccess({
      tenantId: 'tenant-1',
      userId: 'user-1',
      branchId: 'branch-1',
      tokenType: 'CHANGE_PASSWORD_HOSPITAL',
    });

    const refused = await request(app.getHttpServer())
      .get('/auth-probe/hospital')
      .set('Authorization', `Bearer ${change}`);
    expect(refused.status).toBe(401);

    const allowed = await request(app.getHttpServer())
      .get('/auth-probe/change-password')
      .set('Authorization', `Bearer ${change}`);
    expect(allowed.status).toBe(200);

    const open = await request(app.getHttpServer()).get('/auth-probe/public');
    expect(open.status).toBe(200);
  });
});
