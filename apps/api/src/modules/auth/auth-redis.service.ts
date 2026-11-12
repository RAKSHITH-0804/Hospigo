import { Injectable, Logger, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import type { ApiEnv } from '../../config/env';
import { AUTH_REDIS_KEY_PREFIX, type AuthConfig } from './auth.config';

export class AuthRateLimitedError extends Error {
  constructor(readonly retryAfterSec: number) {
    super('AUTH_RATE_LIMITED');
    this.name = 'AuthRateLimitedError';
  }
}

export type AuthLockNamespace = 'login' | 'cpw';

/**
 * Login/refresh rate limit and account lockout (Redis).
 * Fail closed: any Redis error refuses the operation.
 * Keys use prefix hospigo:auth: (overridable in tests via setKeyPrefix).
 * Change-password lockout uses a separate sub-prefix: {prefix}cpw:
 */
@Injectable()
export class AuthRedisService implements OnModuleDestroy {
  private readonly logger = new Logger(AuthRedisService.name);
  private readonly redis: Redis;
  private readonly auth: AuthConfig;
  private keyPrefix = AUTH_REDIS_KEY_PREFIX;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.auth = config.getOrThrow('auth', { infer: true });
    this.redis = new Redis(config.getOrThrow('REDIS_URL', { infer: true }), {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.redis.on('error', (err) => {
      this.logger.warn(`Auth Redis error: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  /** Test-only: isolate keys and allow flush of this prefix. */
  setKeyPrefix(prefix: string): void {
    this.keyPrefix = prefix.endsWith(':') ? prefix : `${prefix}:`;
  }

  getKeyPrefix(): string {
    return this.keyPrefix;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => undefined);
  }

  async assertIpAllowed(ip: string): Promise<void> {
    const key = `${this.keyPrefix}ip:${ip}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.pexpire(key, this.auth.ipRateLimitWindowMs);
      }
      if (count > this.auth.ipRateLimitPerMinute) {
        const ttlMs = await this.redis.pttl(key);
        const retryAfterSec = Math.max(
          1,
          Math.ceil((ttlMs > 0 ? ttlMs : this.auth.ipRateLimitWindowMs) / 1000),
        );
        throw new AuthRateLimitedError(retryAfterSec);
      }
    } catch (error) {
      if (error instanceof AuthRateLimitedError) {
        throw error;
      }
      this.failClosed(error);
    }
  }

  /**
   * Account lockout key stores only a hash of normalized code+email (or hq:email).
   * Never stores raw email.
   */
  accountKeyMaterial(accessCode: string | null, email: string): string {
    const normalized = `${(accessCode ?? '').trim().toLowerCase()}|${email.trim().toLowerCase()}`;
    return createHash('sha256').update(normalized, 'utf8').digest('hex');
  }

  /** Change-password lockout: sha256(tenantId|userId) or sha256(hq|userId). */
  changePasswordKeyMaterial(
    kind: 'hospital' | 'hq',
    tenantId: string | null,
    userId: string,
  ): string {
    const material = kind === 'hospital' ? `${tenantId}|${userId}` : `hq|${userId}`;
    return createHash('sha256').update(material, 'utf8').digest('hex');
  }

  async isAccountLocked(accountHash: string, ns: AuthLockNamespace = 'login'): Promise<boolean> {
    try {
      const locked = await this.redis.get(this.lockKey(ns, accountHash));
      return locked !== null;
    } catch (error) {
      this.failClosed(error);
    }
  }

  async recordFailure(
    accountHash: string,
    ns: AuthLockNamespace = 'login',
  ): Promise<{ locked: boolean }> {
    try {
      const failKey = this.failKey(ns, accountHash);
      const count = await this.redis.incr(failKey);
      if (count === 1) {
        await this.redis.pexpire(failKey, this.auth.loginFailureWindowMs);
      }
      if (count >= this.auth.loginMaxFailures) {
        await this.redis.set(this.lockKey(ns, accountHash), '1', 'PX', this.auth.loginLockoutMs);
        await this.redis.del(failKey);
        return { locked: true };
      }
      return { locked: false };
    } catch (error) {
      this.failClosed(error);
    }
  }

  async clearFailures(accountHash: string, ns: AuthLockNamespace = 'login'): Promise<void> {
    try {
      await this.redis.del(this.failKey(ns, accountHash), this.lockKey(ns, accountHash));
    } catch (error) {
      this.failClosed(error);
    }
  }

  /**
   * Per-account forgot-password throttle (hash of code+email or hq|email).
   * Namespace: {prefix}reset:req:{hash}
   */
  async assertResetAccountAllowed(accountHash: string): Promise<void> {
    const key = `${this.keyPrefix}reset:req:${accountHash}`;
    try {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.pexpire(key, this.auth.resetRequestWindowMs);
      }
      if (count > this.auth.resetMaxRequestsPerWindow) {
        const ttlMs = await this.redis.pttl(key);
        const retryAfterSec = Math.max(
          1,
          Math.ceil((ttlMs > 0 ? ttlMs : this.auth.resetRequestWindowMs) / 1000),
        );
        throw new AuthRateLimitedError(retryAfterSec);
      }
    } catch (error) {
      if (error instanceof AuthRateLimitedError) {
        throw error;
      }
      this.failClosed(error);
    }
  }

  /**
   * Test helper: Redis PTTL in ms for fail/lock keys (-2 missing, -1 no expiry).
   */
  async getFailLockTtlMs(
    accountHash: string,
    ns: AuthLockNamespace = 'login',
  ): Promise<{ failMs: number; lockMs: number }> {
    try {
      const [failMs, lockMs] = await Promise.all([
        this.redis.pttl(this.failKey(ns, accountHash)),
        this.redis.pttl(this.lockKey(ns, accountHash)),
      ]);
      return { failMs, lockMs };
    } catch (error) {
      this.failClosed(error);
    }
  }

  /** Delete only keys under the current prefix (tests). */
  async clearPrefixKeys(): Promise<void> {
    const pattern = `${this.keyPrefix}*`;
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = next;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== '0');
  }

  private nsBase(ns: AuthLockNamespace): string {
    return ns === 'cpw' ? `${this.keyPrefix}cpw:` : this.keyPrefix;
  }

  private failKey(ns: AuthLockNamespace, accountHash: string): string {
    return `${this.nsBase(ns)}fail:${accountHash}`;
  }

  private lockKey(ns: AuthLockNamespace, accountHash: string): string {
    return `${this.nsBase(ns)}lock:${accountHash}`;
  }

  private failClosed(error: unknown): never {
    this.logger.warn(
      `Auth Redis unavailable (fail-closed): ${error instanceof Error ? error.message : String(error)}`,
    );
    throw new ServiceUnavailableException('Authentication temporarily unavailable');
  }
}
