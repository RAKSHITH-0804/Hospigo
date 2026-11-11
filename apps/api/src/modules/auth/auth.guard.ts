import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { enterWithContext, type RequestContext } from '../../common/request-context';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TOKEN_KINDS_KEY } from './token-kinds.decorator';
import { TokenService } from './token.service';
import {
  isHospitalTokenType,
  type AccessClaims,
  type AccessTokenType,
  type HospitalAccessClaims,
} from './token.types';

type AuthedRequest = {
  headers: { authorization?: string };
  auth?: AccessClaims;
  hospigoContext?: RequestContext;
};

/**
 * Per-controller AuthGuard (not global until Step 6a-2 says so).
 * Verifies Bearer JWT, enforces @TokenKinds, sets ALS request context.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const allowed =
      this.reflector.getAllAndOverride<AccessTokenType[]>(TOKEN_KINDS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? (['HOSPITAL'] satisfies AccessTokenType[]);

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing Bearer token');
    }
    const raw = header.slice('Bearer '.length).trim();
    if (!raw) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    const claims = this.tokens.verifyAccess(raw, allowed);
    const ctx = claimsToContext(claims);
    req.auth = claims;
    req.hospigoContext = ctx;
    enterWithContext(ctx);
    return true;
  }
}

function claimsToContext(claims: AccessClaims): RequestContext {
  if (isHospitalTokenType(claims.tokenType)) {
    const hospital = claims as HospitalAccessClaims;
    return {
      tenantId: hospital.tenantId,
      userId: hospital.userId,
      kind: 'HOSPITAL',
      activeBranchId: hospital.branchId,
      requestId: randomUUID(),
    };
  }
  return {
    tenantId: null,
    userId: claims.userId,
    kind: 'HQ',
    activeBranchId: null,
    requestId: randomUUID(),
  };
}
