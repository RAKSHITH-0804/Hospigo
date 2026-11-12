import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { ApiEnv } from '../../config/env';
import { runWithContext } from '../../common/request-context';
import { HqPrismaService } from '../../database/hq-prisma.service';
import { TenantDb } from '../../database/tenant-db';
import { AuthActionPurpose } from '../../generated/prisma';
import type { AuthConfig } from './auth.config';
import { PasswordService } from './password.service';

export type ParsedHospitalActionToken = {
  kind: 'hospital';
  tenantId: string;
  tokenId: string;
  secret: string;
};

export type ParsedHqActionToken = {
  kind: 'hq';
  tokenId: string;
  secret: string;
};

export type ParsedActionToken = ParsedHospitalActionToken | ParsedHqActionToken;

@Injectable()
export class ActionTokenService {
  private readonly auth: AuthConfig;
  private readonly appUrl: string;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly hqPrisma: HqPrismaService,
    private readonly passwords: PasswordService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.auth = config.getOrThrow('auth', { infer: true });
    this.appUrl = config.getOrThrow('APP_URL', { infer: true });
  }

  buildActivationLink(rawToken: string): string {
    return `${this.appUrl}/activate#t=${encodeURIComponent(rawToken)}`;
  }

  buildResetLink(rawToken: string): string {
    return `${this.appUrl}/reset-password#t=${encodeURIComponent(rawToken)}`;
  }

  /**
   * Create hospital action token. Invalidates earlier unused tokens of the same purpose.
   * Returns the raw token for the email link only (never store or log it).
   */
  async createHospitalToken(input: {
    tenantId: string;
    userId: string;
    purpose: AuthActionPurpose;
    requestId: string;
  }): Promise<{ rawToken: string }> {
    const ttlSec =
      input.purpose === AuthActionPurpose.ACTIVATION
        ? this.auth.activationLinkTtlSec
        : this.auth.resetLinkTtlSec;
    const tokenId = newTokenId();
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = this.passwords.hashRefreshSecret(secret);
    const expiresAt = new Date(Date.now() + ttlSec * 1000);
    const rawToken = `h.${input.tenantId}.${tokenId}.${secret}`;

    await runWithContext(
      {
        tenantId: input.tenantId,
        userId: input.userId,
        kind: 'HOSPITAL',
        activeBranchId: null,
        requestId: input.requestId,
      },
      async () => {
        await this.tenantDb.withTenant(async (tx) => {
          await tx.authActionToken.updateMany({
            where: {
              userId: input.userId,
              purpose: input.purpose,
              usedAt: null,
            },
            data: { usedAt: new Date() },
          });
          await tx.authActionToken.create({
            data: {
              id: tokenId,
              tenantId: input.tenantId,
              userId: input.userId,
              purpose: input.purpose,
              tokenHash,
              expiresAt,
            },
          });
        });
      },
    );

    return { rawToken };
  }

  async createHqResetToken(input: { hqUserId: string }): Promise<{ rawToken: string }> {
    const tokenId = newTokenId();
    const secret = randomBytes(32).toString('base64url');
    const tokenHash = this.passwords.hashRefreshSecret(secret);
    const expiresAt = new Date(Date.now() + this.auth.resetLinkTtlSec * 1000);
    const rawToken = `q.${tokenId}.${secret}`;

    await this.hqPrisma.hqAuthActionToken.updateMany({
      where: {
        hqUserId: input.hqUserId,
        purpose: AuthActionPurpose.PASSWORD_RESET,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
    await this.hqPrisma.hqAuthActionToken.create({
      data: {
        id: tokenId,
        hqUserId: input.hqUserId,
        purpose: AuthActionPurpose.PASSWORD_RESET,
        tokenHash,
        expiresAt,
      },
    });

    return { rawToken };
  }

  parseToken(raw: string): ParsedActionToken | null {
    const parts = raw.split('.');
    if (parts[0] === 'h' && parts.length === 4) {
      const [, tenantId, tokenId, secret] = parts;
      if (!tenantId || !tokenId || !secret) {
        return null;
      }
      return { kind: 'hospital', tenantId, tokenId, secret };
    }
    if (parts[0] === 'q' && parts.length === 3) {
      const [, tokenId, secret] = parts;
      if (!tokenId || !secret) {
        return null;
      }
      return { kind: 'hq', tokenId, secret };
    }
    return null;
  }

  verifySecret(secret: string, storedHash: string): boolean {
    return this.passwords.verifyRefreshSecret(secret, storedHash);
  }

  /** Opaque fingerprint for logs (never the secret). */
  tokenFingerprint(rawOrHash: string): string {
    return createHash('sha256').update(rawOrHash, 'utf8').digest('hex').slice(0, 12);
  }
}

function newTokenId(): string {
  return `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;
}
