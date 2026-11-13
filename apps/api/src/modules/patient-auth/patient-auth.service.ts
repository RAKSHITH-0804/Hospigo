import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ApiEnv } from '../../config/env';
import { PatientPrismaService } from '../../database/patient-prisma.service';
import type { AuthConfig } from '../auth/auth.config';
import { authFailed } from '../auth/auth.errors';
import { AuthRedisService } from '../auth/auth-redis.service';
import { TokenService } from '../auth/token.service';
import type { PatientAccessClaims } from '../auth/token.types';
import {
  MESSAGE_PROVIDER,
  type MessageChannel,
  type MessageProvider,
} from '../messaging/message.provider';
import { maskPhoneE164, normalizePhoneIN } from './phone.normalize';

export type PatientTokenPair = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

type OtpPurpose = 'LOGIN' | 'BOOKING';

type AttemptRow = {
  id: string;
  code_hmac: string;
  attempts: number;
};

@Injectable()
export class PatientAuthService {
  private readonly logger = new Logger(PatientAuthService.name);
  private readonly auth: AuthConfig;

  constructor(
    private readonly patientPrisma: PatientPrismaService,
    private readonly redis: AuthRedisService,
    private readonly tokens: TokenService,
    @Inject(MESSAGE_PROVIDER) private readonly messages: MessageProvider,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.auth = config.getOrThrow('auth', { infer: true });
  }

  async requestOtp(
    phoneRaw: string,
    purpose: OtpPurpose,
    ip: string,
  ): Promise<{ ok: true; resendAfterSec: number }> {
    const phone = normalizePhoneIN(phoneRaw);
    await this.redis.assertOtpIpAllowed(ip);
    const phoneHash = this.redis.phoneKeyMaterial(phone);
    await this.redis.assertOtpResendAllowed(phoneHash);
    await this.redis.assertOtpPhoneHourlyAllowed(phoneHash);

    const code = this.generateCode();
    const codeHmac = this.hmacCode(phone, purpose, code);
    const channel = this.auth.otpDefaultChannel;
    const challengeId = randomUUID();
    const ttlSec = this.auth.otpTtlSec;
    const cooldownSec = this.auth.otpResendCooldownSec;

    // Single statement: invalidate older open challenges + insert the new one (no Prisma $transaction).
    await this.patientPrisma.$executeRaw`
      WITH invalidated AS (
        UPDATE patient_otp_challenges
        SET consumed_at = now()
        WHERE phone_e164 = ${phone}
          AND purpose = CAST(${purpose} AS patient_otp_purpose)
          AND consumed_at IS NULL
        RETURNING id
      )
      INSERT INTO patient_otp_challenges (
        id,
        phone_e164,
        purpose,
        code_hmac,
        channel,
        expires_at,
        attempts,
        resend_available_at,
        created_at
      )
      VALUES (
        ${challengeId},
        ${phone},
        CAST(${purpose} AS patient_otp_purpose),
        ${codeHmac},
        CAST(${channel} AS patient_otp_channel),
        now() + (${ttlSec} * INTERVAL '1 second'),
        0,
        now() + (${cooldownSec} * INTERVAL '1 second'),
        now()
      )
    `;

    await this.redis.markOtpResendCooldown(phoneHash);

    const text = `Your Hospigo verification code is ${code}. It expires in ${this.auth.otpTtlSec} seconds.`;
    await this.messages.send(channel as MessageChannel, phone, text);

    this.logger.log(
      `OTP requested purpose=${purpose} phone=${maskPhoneE164(phone)} channel=${channel}`,
    );

    return { ok: true, resendAfterSec: this.auth.otpResendCooldownSec };
  }

  async verifyOtp(
    phoneRaw: string,
    codeRaw: string,
    purpose: OtpPurpose,
    ip: string,
    meta: { userAgent: string | undefined },
  ): Promise<PatientTokenPair> {
    await this.redis.assertOtpIpAllowed(ip);
    const phone = normalizePhoneIN(phoneRaw);
    const code = String(codeRaw ?? '').trim();
    const maxAttempts = this.auth.otpMaxAttempts;

    const latest = await this.patientPrisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM patient_otp_challenges
      WHERE phone_e164 = ${phone}
        AND purpose = CAST(${purpose} AS patient_otp_purpose)
        AND consumed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const challengeId = latest[0]?.id;
    if (!challengeId) {
      this.logger.warn(`OTP verify failed (missing) phone=${maskPhoneE164(phone)}`);
      authFailed();
    }

    // Take one attempt atomically before comparing (DB clock for expiry).
    const claimed = await this.patientPrisma.$queryRaw<AttemptRow[]>`
      UPDATE patient_otp_challenges
      SET attempts = attempts + 1
      WHERE id = ${challengeId}
        AND consumed_at IS NULL
        AND attempts < ${maxAttempts}
        AND expires_at > now()
      RETURNING id, code_hmac, attempts
    `;
    const row = claimed[0];
    if (!row) {
      this.logger.warn(`OTP verify failed (dead/expired) phone=${maskPhoneE164(phone)}`);
      authFailed();
    }

    const expected = Buffer.from(row.code_hmac, 'utf8');
    const actual = Buffer.from(this.hmacCode(phone, purpose, code), 'utf8');
    const match = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!match) {
      if (row.attempts >= maxAttempts) {
        await this.patientPrisma.$executeRaw`
          UPDATE patient_otp_challenges
          SET consumed_at = now()
          WHERE id = ${row.id}
            AND consumed_at IS NULL
        `;
      }
      this.logger.warn(
        `OTP verify failed (wrong code) phone=${maskPhoneE164(phone)} attempts=${row.attempts}`,
      );
      authFailed();
    }

    const consumed = await this.patientPrisma.$executeRaw`
      UPDATE patient_otp_challenges
      SET consumed_at = now()
      WHERE id = ${row.id}
        AND consumed_at IS NULL
    `;
    if (Number(consumed) !== 1) {
      this.logger.warn(`OTP verify failed (consume race) phone=${maskPhoneE164(phone)}`);
      authFailed();
    }

    const account = await this.patientPrisma.patientAccount.upsert({
      where: { phoneE164: phone },
      create: { phoneE164: phone, status: 'ACTIVE', lastLoginAt: new Date() },
      update: { lastLoginAt: new Date() },
    });

    if (account.status !== 'ACTIVE') {
      this.logger.warn(`OTP verify failed (disabled) phone=${maskPhoneE164(phone)}`);
      authFailed();
    }

    const pair = await this.createSession({
      accountId: account.id,
      ip,
      userAgent: meta.userAgent,
    });
    this.logger.log(`OTP verify success phone=${maskPhoneE164(phone)} accountId=${account.id}`);
    return pair;
  }

  async refresh(
    refreshToken: string,
    meta: { ip: string; userAgent: string | undefined },
  ): Promise<PatientTokenPair> {
    await this.redis.assertOtpIpAllowed(meta.ip);
    const parts = this.tokens.parseRefreshToken(refreshToken);
    if (!parts || parts.kind !== 'patient') {
      authFailed();
    }

    const session = await this.patientPrisma.patientAuthSession.findUnique({
      where: { id: parts.sessionId },
    });
    if (!session || !this.tokens.verifyRefreshSecret(parts.secret, session.tokenHash)) {
      authFailed();
    }
    if (session.revokedAt || session.replacedById) {
      await this.patientPrisma.patientAuthSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Patient refresh reuse detected familyId=${session.familyId}`);
      authFailed();
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.patientPrisma.patientAuthSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      authFailed();
    }

    const account = await this.patientPrisma.patientAccount.findUnique({
      where: { id: session.accountId },
    });
    if (!account || account.status !== 'ACTIVE') {
      await this.patientPrisma.patientAuthSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      authFailed();
    }

    const newSession = await this.patientPrisma.patientAuthSession.create({
      data: {
        accountId: account.id,
        tokenHash: 'pending',
        familyId: session.familyId,
        expiresAt: new Date(Date.now() + this.auth.patientRefreshTokenTtlSec * 1000),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    const issued = this.tokens.issueRefreshToken({
      kind: 'patient',
      sessionId: newSession.id,
    });
    await this.patientPrisma.patientAuthSession.update({
      where: { id: newSession.id },
      data: { tokenHash: issued.tokenHash },
    });
    await this.patientPrisma.patientAuthSession.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        replacedById: newSession.id,
        lastUsedAt: new Date(),
      },
    });

    const accessToken = this.tokens.signPatientAccess({ accountId: account.id });
    return {
      accessToken,
      refreshToken: issued.raw,
      expiresIn: this.tokens.accessExpiresInSec('PATIENT'),
    };
  }

  /**
   * Public logout: possession of the refresh secret is enough.
   * Valid token → revoke the whole family. Unknown/malformed → same generic success.
   */
  async logout(refreshToken: string): Promise<{ ok: true }> {
    const parts = this.tokens.parseRefreshToken(refreshToken);
    if (!parts || parts.kind !== 'patient') {
      return { ok: true };
    }
    const session = await this.patientPrisma.patientAuthSession.findUnique({
      where: { id: parts.sessionId },
    });
    if (!session || !this.tokens.verifyRefreshSecret(parts.secret, session.tokenHash)) {
      return { ok: true };
    }
    await this.patientPrisma.patientAuthSession.updateMany({
      where: { familyId: session.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  async me(claims: PatientAccessClaims): Promise<{
    id: string;
    phone: string;
    createdAt: string;
    linkedProfiles: [];
  }> {
    const account = await this.patientPrisma.patientAccount.findUnique({
      where: { id: claims.accountId },
    });
    if (!account || account.status !== 'ACTIVE') {
      authFailed();
    }
    return {
      id: account.id,
      phone: maskPhoneE164(account.phoneE164),
      createdAt: account.createdAt.toISOString(),
      linkedProfiles: [],
    };
  }

  private async createSession(input: {
    accountId: string;
    ip: string;
    userAgent: string | undefined;
  }): Promise<PatientTokenPair> {
    const familyId = randomUUID();
    const session = await this.patientPrisma.patientAuthSession.create({
      data: {
        accountId: input.accountId,
        tokenHash: 'pending',
        familyId,
        expiresAt: new Date(Date.now() + this.auth.patientRefreshTokenTtlSec * 1000),
        ip: input.ip,
        userAgent: input.userAgent,
      },
    });
    const issued = this.tokens.issueRefreshToken({
      kind: 'patient',
      sessionId: session.id,
    });
    await this.patientPrisma.patientAuthSession.update({
      where: { id: session.id },
      data: { tokenHash: issued.tokenHash },
    });
    const accessToken = this.tokens.signPatientAccess({ accountId: input.accountId });
    return {
      accessToken,
      refreshToken: issued.raw,
      expiresIn: this.tokens.accessExpiresInSec('PATIENT'),
    };
  }

  private generateCode(): string {
    const max = 10 ** this.auth.otpCodeLength;
    const n = randomInt(0, max);
    return String(n).padStart(this.auth.otpCodeLength, '0');
  }

  private hmacCode(phone: string, purpose: OtpPurpose, code: string): string {
    return createHmac('sha256', this.auth.otpHashSecret)
      .update(`${phone}|${purpose}|${code}`, 'utf8')
      .digest('hex');
  }
}
