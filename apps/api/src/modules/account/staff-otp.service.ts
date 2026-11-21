import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { ApiEnv } from '../../config/env';
import type { AuthConfig } from '../auth/auth.config';
import { AuthRateLimitedError, AuthRedisService } from '../auth/auth-redis.service';
import { MAIL_PROVIDER, type MailProvider } from '../mail/mail.provider';
import { otpEmail } from '../mail/mail.templates';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';

export type OtpPurpose = 'PASSWORD' | 'EMAIL';

const WHAT: Record<OtpPurpose, string> = {
  PASSWORD: 'change your password',
  EMAIL: 'change your email address',
};

/**
 * The code a signed-in person types to prove they own the mailbox before the password or the email
 * address is changed. Nothing secret goes through the mail queue: the code is made here, only its
 * hash is kept (in Redis, with a time limit), and it goes straight to the mail provider. A code works
 * once, only a few wrong tries are allowed, and requests are limited per person, per hour and per IP.
 */
@Injectable()
export class StaffOtpService {
  private readonly logger = new Logger(StaffOtpService.name);
  private readonly auth: AuthConfig;

  constructor(
    config: ConfigService<ApiEnv, true>,
    private readonly redis: AuthRedisService,
    @Inject(MAIL_PROVIDER) private readonly mail: MailProvider,
  ) {
    this.auth = config.getOrThrow('auth', { infer: true });
  }

  /** Makes a code, keeps its hash, and mails it to `to` (the mailbox the person must own). */
  async request(args: {
    tenantId: string;
    userId: string;
    purpose: OtpPurpose;
    to: string;
    ip: string;
    pendingEmail?: string;
  }): Promise<void> {
    const key = this.keyOf(args.tenantId, args.userId, args.purpose);
    try {
      await this.redis.assertOtpIpAllowed(args.ip);
      await this.redis.assertOtpResendAllowed(key);
      await this.redis.assertOtpPhoneHourlyAllowed(key);
      await this.redis.markOtpResendCooldown(key);
    } catch (error) {
      if (error instanceof AuthRateLimitedError) {
        throw opdError(429, OpdErrorCode.RATE_LIMITED, { retryAfterSec: error.retryAfterSec });
      }
      throw error;
    }
    const length = this.auth.otpCodeLength;
    const code = String(randomInt(10 ** (length - 1), 10 ** length));
    await this.redis.putStaffOtp(
      key,
      {
        hmac: this.hmac(args.tenantId, args.userId, args.purpose, code),
        ...(args.pendingEmail ? { pendingEmail: args.pendingEmail } : {}),
      },
      this.auth.otpTtlSec,
    );
    const content = otpEmail(
      code,
      Math.max(1, Math.round(this.auth.otpTtlSec / 60)),
      WHAT[args.purpose],
    );
    try {
      await this.mail.send({ to: args.to, ...content });
    } catch (error) {
      await this.redis.dropStaffOtp(key);
      this.logger.warn(`Code email failed purpose=${args.purpose}: ${(error as Error).message}`);
      throw new HttpException({ statusCode: 503, code: 'UNAVAILABLE' }, 503);
    }
  }

  /** Checks the code. It works once; too many wrong tries end it. Returns the pending email if any. */
  async verify(args: {
    tenantId: string;
    userId: string;
    purpose: OtpPurpose;
    code: string;
  }): Promise<{ pendingEmail: string | null }> {
    const key = this.keyOf(args.tenantId, args.userId, args.purpose);
    const row = await this.redis.getStaffOtp(key);
    if (!row?.hmac) {
      throw opdError(400, OpdErrorCode.OTP_INVALID, { reason: 'EXPIRED' });
    }
    const attempts = await this.redis.bumpStaffOtpAttempts(key);
    if (attempts > this.auth.otpMaxAttempts) {
      await this.redis.dropStaffOtp(key);
      throw opdError(400, OpdErrorCode.OTP_INVALID, { reason: 'TOO_MANY_TRIES' });
    }
    const expected = Buffer.from(row.hmac, 'utf8');
    const actual = Buffer.from(
      this.hmac(args.tenantId, args.userId, args.purpose, args.code),
      'utf8',
    );
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw opdError(400, OpdErrorCode.OTP_INVALID, { reason: 'WRONG_CODE' });
    }
    if (!(await this.redis.dropStaffOtp(key))) {
      // another request used this code at the same moment
      throw opdError(400, OpdErrorCode.OTP_INVALID, { reason: 'EXPIRED' });
    }
    return { pendingEmail: row.pendingEmail ?? null };
  }

  private keyOf(tenantId: string, userId: string, purpose: OtpPurpose): string {
    return createHash('sha256').update(`staff|${tenantId}|${userId}|${purpose}`).digest('hex');
  }

  private hmac(tenantId: string, userId: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.auth.otpHashSecret)
      .update(`${tenantId}|${userId}|${purpose}|${code}`)
      .digest('hex');
  }
}
