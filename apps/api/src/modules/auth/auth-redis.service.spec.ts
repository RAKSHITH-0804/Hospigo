import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { loadAuthConfig } from './auth.config';
import { AuthRedisService } from './auth-redis.service';

const HOSPITAL = 'hospital-access-secret-value-32chars!!';
const HQ = 'hq-access-secret-value-32-characters!!!';

describe('AuthRedisService', () => {
  it('fail-closed: unreachable Redis refuses assertIpAllowed with 503', async () => {
    const auth = loadAuthConfig({
      JWT_HOSPITAL_ACCESS_SECRET: HOSPITAL,
      JWT_HQ_ACCESS_SECRET: HQ,
    });
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'auth') return auth;
        if (key === 'REDIS_URL') return 'redis://127.0.0.1:1';
        throw new Error(`unexpected ${key}`);
      },
    } as unknown as ConfigService;

    const service = new AuthRedisService(config);
    service.setKeyPrefix('hospigo:auth:unit:');
    await expect(service.assertIpAllowed('127.0.0.1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await service.onModuleDestroy();
  });

  it('accountKeyMaterial never embeds raw email', () => {
    const auth = loadAuthConfig({
      JWT_HOSPITAL_ACCESS_SECRET: HOSPITAL,
      JWT_HQ_ACCESS_SECRET: HQ,
    });
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'auth') return auth;
        if (key === 'REDIS_URL') return process.env.REDIS_URL || 'redis://127.0.0.1:6379';
        throw new Error(`unexpected ${key}`);
      },
    } as unknown as ConfigService;
    const service = new AuthRedisService(config);
    const key = service.accountKeyMaterial('CODE', 'person@example.test');
    expect(key).toHaveLength(64);
    expect(key).not.toContain('person');
    expect(key).not.toContain('@');
    void service.onModuleDestroy();
  });
});
