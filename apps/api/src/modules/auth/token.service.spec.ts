import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { loadAuthConfig } from './auth.config';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const HOSPITAL = 'hospital-access-secret-value-32chars!!';
const HQ = 'hq-access-secret-value-32-characters!!!';

function services(): TokenService {
  const auth = loadAuthConfig({
    JWT_HOSPITAL_ACCESS_SECRET: HOSPITAL,
    JWT_HQ_ACCESS_SECRET: HQ,
    AUTH_ACCESS_TOKEN_TTL_SEC: '900',
  });
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'auth') return auth;
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as ConfigService;
  const passwords = new PasswordService(config);
  return new TokenService(passwords, config);
}

describe('TokenService', () => {
  it('signs and verifies hospital and HQ tokens with separate keys', () => {
    const tokens = services();
    const hospital = tokens.signHospitalAccess({
      tenantId: 't1',
      userId: 'u1',
      branchId: 'b1',
    });
    const hq = tokens.signHqAccess({ userId: 'hq1' });

    expect(tokens.verifyAccess(hospital, ['HOSPITAL']).tokenType).toBe('HOSPITAL');
    expect(tokens.verifyAccess(hq, ['HQ']).tokenType).toBe('HQ');
    expect(() => tokens.verifyAccess(hospital, ['HQ'])).toThrow(UnauthorizedException);
    expect(() => tokens.verifyAccess(hq, ['HOSPITAL'])).toThrow(UnauthorizedException);
  });

  it('rejects wrong type, wrong key, and expired tokens', () => {
    const tokens = services();
    const change = tokens.signHospitalAccess({
      tenantId: 't1',
      userId: 'u1',
      branchId: 'b1',
      tokenType: 'CHANGE_PASSWORD_HOSPITAL',
    });
    expect(() => tokens.verifyAccess(change, ['HOSPITAL'])).toThrow(UnauthorizedException);
    expect(tokens.verifyAccess(change, ['CHANGE_PASSWORD_HOSPITAL']).tokenType).toBe(
      'CHANGE_PASSWORD_HOSPITAL',
    );

    const expired = jwt.sign(
      { tokenType: 'HOSPITAL', tenantId: 't1', userId: 'u1', branchId: 'b1', sub: 'u1' },
      HOSPITAL,
      { algorithm: 'HS256', expiresIn: -10 },
    );
    expect(() => tokens.verifyAccess(expired, ['HOSPITAL'])).toThrow(UnauthorizedException);

    const wrongKey = jwt.sign(
      { tokenType: 'HOSPITAL', tenantId: 't1', userId: 'u1', branchId: 'b1', sub: 'u1' },
      HQ,
      { algorithm: 'HS256', expiresIn: 60 },
    );
    expect(() => tokens.verifyAccess(wrongKey, ['HOSPITAL'])).toThrow(UnauthorizedException);
  });

  it('rejects alg none and HS384 tokens', () => {
    const tokens = services();
    const payload = {
      tokenType: 'HOSPITAL',
      tenantId: 't1',
      userId: 'u1',
      branchId: 'b1',
      sub: 'u1',
    };

    const headerNone = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString(
      'base64url',
    );
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const noneToken = `${headerNone}.${body}.`;
    expect(() => tokens.verifyAccess(noneToken, ['HOSPITAL'])).toThrow(UnauthorizedException);

    const hs384 = jwt.sign(payload, HOSPITAL, { algorithm: 'HS384', expiresIn: 60 });
    expect(() => tokens.verifyAccess(hs384, ['HOSPITAL'])).toThrow(UnauthorizedException);
  });

  it('issues parseable refresh tokens that embed tenant for hospital sessions', () => {
    const tokens = services();
    const hospital = tokens.issueRefreshToken({
      kind: 'hospital',
      tenantId: 'tenantA',
      sessionId: 'sess1',
    });
    const parsed = tokens.parseRefreshToken(hospital.raw);
    expect(parsed).toEqual({
      kind: 'hospital',
      tenantId: 'tenantA',
      sessionId: 'sess1',
      secret: expect.any(String),
    });
    expect(hospital.raw.startsWith('h.tenantA.sess1.')).toBe(true);
    expect(hospital.tokenHash).toBe(tokens.refreshTokenHashFromSecret(parsed!.secret));
    expect(tokens.verifyRefreshSecret(parsed!.secret, hospital.tokenHash)).toBe(true);

    const hq = tokens.issueRefreshToken({ kind: 'hq', sessionId: 'hqSess' });
    expect(tokens.parseRefreshToken(hq.raw)).toMatchObject({
      kind: 'hq',
      sessionId: 'hqSess',
    });
  });
});
