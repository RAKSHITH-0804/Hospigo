import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import type { ApiEnv } from '../../config/env';
import type { AuthConfig } from './auth.config';

/** Small deny-list of common passwords (normalized lowercase). Not exhaustive. */
const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password12',
    'password123',
    'password1234',
    '1234567890',
    '12345678901',
    'qwertyuiop',
    'letmein123',
    'welcome123',
    'admin12345',
    'changeme12',
    'hospital123',
    'hospigo123',
  ].map((p) => p.toLowerCase()),
);

const TEMP_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TEMP_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const TEMP_DIGIT = '23456789';
const TEMP_SYMBOL = '!@#$%^&*-_=+';
const TEMP_ALL = TEMP_UPPER + TEMP_LOWER + TEMP_DIGIT + TEMP_SYMBOL;

export type PasswordValidationResult =
  { ok: true } | { ok: false; reason: 'TOO_SHORT' | 'COMMON_PASSWORD' };

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly auth: AuthConfig;
  /** Startup-generated dummy plain + hash for timing equalization (never logged). */
  private dummyPlain = '';
  private dummyHash = '';

  constructor(config: ConfigService<ApiEnv, true>) {
    this.auth = config.getOrThrow('auth', { infer: true });
  }

  async onModuleInit(): Promise<void> {
    this.dummyPlain = randomBytes(32).toString('base64url');
    this.dummyHash = await argon2.hash(this.dummyPlain, { type: argon2.argon2id });
  }

  /**
   * Run whenever no real password hash is checked so failure paths take similar time.
   */
  async burnVerifyTime(): Promise<void> {
    if (!this.dummyHash) {
      await this.onModuleInit();
    }
    try {
      await argon2.verify(this.dummyHash, this.dummyPlain);
    } catch {
      // ignore
    }
  }

  validatePlainPassword(plain: string): PasswordValidationResult {
    if (plain.length < this.auth.passwordMinLength) {
      return { ok: false, reason: 'TOO_SHORT' };
    }
    if (COMMON_PASSWORDS.has(plain.toLowerCase())) {
      return { ok: false, reason: 'COMMON_PASSWORD' };
    }
    return { ok: true };
  }

  async hash(plain: string): Promise<string> {
    const check = this.validatePlainPassword(plain);
    if (!check.ok) {
      throw new Error(`Password rejected: ${check.reason}`);
    }
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async hashTrusted(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain);
    } catch {
      return false;
    }
  }

  /**
   * Cryptographically random temporary password.
   * Length and character-class mix come from auth config (default 14, mixed classes).
   */
  generateTempPassword(): string {
    const length = this.auth.tempPasswordLength;
    const chars: string[] = [
      TEMP_UPPER[randomInt(TEMP_UPPER.length)]!,
      TEMP_LOWER[randomInt(TEMP_LOWER.length)]!,
      TEMP_DIGIT[randomInt(TEMP_DIGIT.length)]!,
      TEMP_SYMBOL[randomInt(TEMP_SYMBOL.length)]!,
    ];
    while (chars.length < length) {
      chars.push(TEMP_ALL[randomInt(TEMP_ALL.length)]!);
    }
    // Fisher–Yates using crypto
    for (let i = chars.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      const tmp = chars[i]!;
      chars[i] = chars[j]!;
      chars[j] = tmp;
    }
    return chars.join('');
  }

  /** Hash an opaque refresh secret for storage (never store the raw secret). */
  hashRefreshSecret(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  /**
   * Constant-time refresh secret check. Every refresh verification must use this
   * (or TokenService.verifyRefreshSecret); never compare hashes with ===.
   * Hashes the presented secret with SHA-256 and compares via timingSafeEqual.
   * Returns false on length mismatch without throwing.
   */
  verifyRefreshSecret(rawSecret: string, storedHash: string): boolean {
    const presented = Buffer.from(this.hashRefreshSecret(rawSecret), 'utf8');
    const stored = Buffer.from(storedHash, 'utf8');
    if (presented.length !== stored.length) {
      return false;
    }
    return timingSafeEqual(presented, stored);
  }

  randomRefreshSecret(): string {
    return randomBytes(32).toString('base64url');
  }
}
