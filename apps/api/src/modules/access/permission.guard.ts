import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { requireContext } from '../../common/request-context';
import { AccessService } from './access.service';
import {
  AUTHENTICATED_ONLY_KEY,
  REQUIRE_PERMISSION_KEY,
  type RequirePermissionMeta,
} from './permission.decorators';

const FORBIDDEN_BODY = {
  statusCode: 403,
  message: 'Forbidden',
  error: 'Forbidden',
} as const;

/**
 * Second global guard (after AuthGuard). Deny-by-default for HTTP routes that
 * lack @Public, @AuthenticatedOnly, or @RequirePermission.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const permission = this.reflector.getAllAndOverride<RequirePermissionMeta | undefined>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    const authenticatedOnly = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const markers = [Boolean(isPublic), Boolean(permission), Boolean(authenticatedOnly)].filter(
      Boolean,
    ).length;
    if (markers > 1) {
      this.logger.warn('Route has more than one access marker');
      throw new ForbiddenException(FORBIDDEN_BODY);
    }
    if (markers === 0) {
      this.logger.warn('Route has no access marker (denied by default)');
      throw new ForbiddenException(FORBIDDEN_BODY);
    }

    if (isPublic || authenticatedOnly) {
      return true;
    }

    // RequirePermission path
    let ctx;
    try {
      ctx = requireContext();
    } catch {
      throw new ForbiddenException(FORBIDDEN_BODY);
    }
    if (ctx.kind !== 'HOSPITAL' || !ctx.tenantId || !ctx.activeBranchId || !permission) {
      this.logger.warn('RequirePermission refused (non-hospital or missing branch)');
      throw new ForbiddenException(FORBIDDEN_BODY);
    }

    const allowed = await this.access.can(permission.code, ctx.activeBranchId, permission.module);
    if (!allowed) {
      this.logger.warn(`Permission denied for code=${permission.code}`);
      throw new ForbiddenException(FORBIDDEN_BODY);
    }
    return true;
  }
}
