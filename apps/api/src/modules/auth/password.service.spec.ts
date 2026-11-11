import { ConfigService } from '@nestjs/config';
import { loadAuthConfig } from './auth.config';
import { PasswordService } from './password.service';

const HOSPITAL = 'hospital-access-secret-value-32chars!!';
const HQ = 'hq-access-secret-value-32-characters!!!';

function service(): PasswordService {
  const auth = loadAuthConfig({
    JWT_HOSPITAL_ACCESS_SECRET: HOSPITAL,
    JWT_HQ_ACCESS_SECRET: HQ,
  });
  const config = {
    getOrThrow: (key: string) => {
      if (key === 'auth') return auth;
      throw new Error(`unexpected key ${key}`);
    },
  } as unknown as ConfigService;
  return new PasswordService(config);
}

describe('PasswordService', () => {
  it('hashes and verifies with argon2id', async () => {
    const passwords = service();
    const hash = await passwords.hash('CorrectHorse9!');
    expect(hash).not.toContain('CorrectHorse9!');
    expect(await passwords.verify(hash, 'CorrectHorse9!')).toBe(true);
    expect(await passwords.verify(hash, 'wrong-password')).toBe(false);
  });

  it('rejects short and common passwords', async () => {
    const passwords = service();
    expect(passwords.validatePlainPassword('short')).toEqual({
      ok: false,
      reason: 'TOO_SHORT',
    });
    expect(passwords.validatePlainPassword('password123')).toEqual({
      ok: false,
      reason: 'COMMON_PASSWORD',
    });
    await expect(passwords.hash('password123')).rejects.toThrow(/COMMON_PASSWORD/);
  });

  it('generates mixed-class temp passwords of configured length', () => {
    const passwords = service();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const temp = passwords.generateTempPassword();
      expect(temp).toHaveLength(14);
      expect(temp).toMatch(/[A-Z]/);
      expect(temp).toMatch(/[a-z]/);
      expect(temp).toMatch(/[0-9]/);
      expect(temp).toMatch(/[!@#$%^&*\-_=+]/);
      seen.add(temp);
    }
    expect(seen.size).toBe(20);
  });

  it('verifyRefreshSecret is constant-time and rejects mismatches without throwing', () => {
    const passwords = service();
    const secret = passwords.randomRefreshSecret();
    const stored = passwords.hashRefreshSecret(secret);

    expect(passwords.verifyRefreshSecret(secret, stored)).toBe(true);
    expect(passwords.verifyRefreshSecret('wrong-secret-value', stored)).toBe(false);
    expect(passwords.verifyRefreshSecret(secret, 'short')).toBe(false);
    expect(() => passwords.verifyRefreshSecret(secret, 'short')).not.toThrow();
    expect(() => passwords.verifyRefreshSecret(secret, stored)).not.toThrow();
  });
});
