import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import type { ApiEnv } from '../../config/env';
import type { AuthConfig } from './auth.config';
import { PasswordService } from './password.service';
import {
  isAccessTokenType,
  isHospitalTokenType,
  isHqTokenType,
  type AccessClaims,
  type AccessTokenType,
  type HospitalAccessClaims,
  type HqAccessClaims,
  type RefreshTokenParts,
} from './token.types';

type JwtPayload = {
  tokenType?: unknown;
  tenantId?: unknown;
  userId?: unknown;
  branchId?: unknown;
  sub?: unknown;
};

/** Access/refresh token helpers. Access JWTs are always HS256-only. */
@Injectable()
export class TokenService {
  private readonly auth: AuthConfig;

  constructor(
    private readonly passwords: PasswordService,
    config: ConfigService<ApiEnv, true>,
  ) {
    this.auth = config.getOrThrow('auth', { infer: true });
  }

  signHospitalAccess(
    claims: Omit<HospitalAccessClaims, 'tokenType'> & {
      tokenType?: 'HOSPITAL' | 'CHANGE_PASSWORD_HOSPITAL';
    },
  ): string {
    const tokenType = claims.tokenType ?? 'HOSPITAL';
    const expiresIn =
      tokenType === 'CHANGE_PASSWORD_HOSPITAL'
        ? this.auth.changePasswordTokenTtlSec
        : this.auth.accessTokenTtlSec;
    return jwt.sign(
      {
        tokenType,
        tenantId: claims.tenantId,
        userId: claims.userId,
        branchId: claims.branchId,
        sub: claims.userId,
      },
      this.auth.jwtHospitalAccessSecret,
      { algorithm: 'HS256', expiresIn },
    );
  }

  signHqAccess(
    claims: Omit<HqAccessClaims, 'tokenType'> & { tokenType?: 'HQ' | 'CHANGE_PASSWORD_HQ' },
  ): string {
    const tokenType = claims.tokenType ?? 'HQ';
    const expiresIn =
      tokenType === 'CHANGE_PASSWORD_HQ'
        ? this.auth.changePasswordTokenTtlSec
        : this.auth.accessTokenTtlSec;
    return jwt.sign(
      {
        tokenType,
        userId: claims.userId,
        sub: claims.userId,
      },
      this.auth.jwtHqAccessSecret,
      { algorithm: 'HS256', expiresIn },
    );
  }

  accessExpiresInSec(tokenType?: string): number {
    if (tokenType === 'CHANGE_PASSWORD_HOSPITAL' || tokenType === 'CHANGE_PASSWORD_HQ') {
      return this.auth.changePasswordTokenTtlSec;
    }
    return this.auth.accessTokenTtlSec;
  }

  verifyAccess(token: string, allowedTypes: readonly AccessTokenType[]): AccessClaims {
    if (allowedTypes.length === 0) {
      throw new UnauthorizedException('No token types allowed');
    }

    const hospitalAllowed = allowedTypes.some(isHospitalTokenType);
    const hqAllowed = allowedTypes.some(isHqTokenType);

    let lastError: unknown;
    if (hospitalAllowed) {
      try {
        return this.verifyWithSecret(token, this.auth.jwtHospitalAccessSecret, allowedTypes, true);
      } catch (error) {
        lastError = error;
      }
    }
    if (hqAllowed) {
      try {
        return this.verifyWithSecret(token, this.auth.jwtHqAccessSecret, allowedTypes, false);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof UnauthorizedException) {
      throw lastError;
    }
    throw new UnauthorizedException('Invalid access token');
  }

  /**
   * Issue an opaque refresh token string and the hash to store.
   * Format:
   * - hospital: `h.<tenantId>.<sessionId>.<secret>`
   * - hq: `q.<sessionId>.<secret>`
   */
  issueRefreshToken(input: { kind: 'hospital'; tenantId: string; sessionId: string }): {
    raw: string;
    tokenHash: string;
  };
  issueRefreshToken(input: { kind: 'hq'; sessionId: string }): {
    raw: string;
    tokenHash: string;
  };
  issueRefreshToken(input: { kind: 'hospital' | 'hq'; tenantId?: string; sessionId: string }): {
    raw: string;
    tokenHash: string;
  } {
    const secret = this.passwords.randomRefreshSecret();
    const tokenHash = this.passwords.hashRefreshSecret(secret);
    if (input.kind === 'hospital') {
      if (!input.tenantId) {
        throw new Error('tenantId is required for hospital refresh tokens');
      }
      return {
        raw: `h.${input.tenantId}.${input.sessionId}.${secret}`,
        tokenHash,
      };
    }
    return {
      raw: `q.${input.sessionId}.${secret}`,
      tokenHash,
    };
  }

  parseRefreshToken(raw: string): RefreshTokenParts | null {
    const parts = raw.split('.');
    if (parts[0] === 'h' && parts.length === 4) {
      const [, tenantId, sessionId, secret] = parts;
      if (!tenantId || !sessionId || !secret) {
        return null;
      }
      return { kind: 'hospital', tenantId, sessionId, secret };
    }
    if (parts[0] === 'q' && parts.length === 3) {
      const [, sessionId, secret] = parts;
      if (!sessionId || !secret) {
        return null;
      }
      return { kind: 'hq', sessionId, secret };
    }
    return null;
  }

  refreshTokenHashFromSecret(secret: string): string {
    return this.passwords.hashRefreshSecret(secret);
  }

  /**
   * Every refresh-token verification must use PasswordService.verifyRefreshSecret
   * (constant-time). Do not compare hashes with ===.
   */
  verifyRefreshSecret(rawSecret: string, storedHash: string): boolean {
    return this.passwords.verifyRefreshSecret(rawSecret, storedHash);
  }

  private verifyWithSecret(
    token: string,
    secret: string,
    allowedTypes: readonly AccessTokenType[],
    expectHospitalKey: boolean,
  ): AccessClaims {
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, secret, { algorithms: ['HS256'] }) as JwtPayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    if (!isAccessTokenType(payload.tokenType)) {
      throw new UnauthorizedException('Invalid token type');
    }
    if (!allowedTypes.includes(payload.tokenType)) {
      throw new UnauthorizedException('Token type not allowed for this route');
    }
    if (expectHospitalKey && !isHospitalTokenType(payload.tokenType)) {
      throw new UnauthorizedException('Token type does not match signing key');
    }
    if (!expectHospitalKey && !isHqTokenType(payload.tokenType)) {
      throw new UnauthorizedException('Token type does not match signing key');
    }

    if (typeof payload.userId !== 'string' || payload.userId.length === 0) {
      throw new UnauthorizedException('Invalid token subject');
    }

    const tokenType = payload.tokenType;
    if (isHospitalTokenType(tokenType)) {
      if (typeof payload.tenantId !== 'string' || typeof payload.branchId !== 'string') {
        throw new UnauthorizedException('Invalid hospital token claims');
      }
      const hospitalClaims: HospitalAccessClaims = {
        tokenType,
        tenantId: payload.tenantId,
        userId: payload.userId,
        branchId: payload.branchId,
      };
      return hospitalClaims;
    }

    if (isHqTokenType(tokenType)) {
      const hqClaims: HqAccessClaims = {
        tokenType,
        userId: payload.userId,
      };
      return hqClaims;
    }

    throw new UnauthorizedException('Invalid token type');
  }
}
