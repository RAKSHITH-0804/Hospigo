import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'access:requirePermission';
export const AUTHENTICATED_ONLY_KEY = 'access:authenticatedOnly';

export type RequirePermissionOptions = {
  /** Optional module code checked via AccessService.can(..., moduleCode). */
  module?: string;
};

export type RequirePermissionMeta = {
  code: string;
  module?: string;
};

/** Require AccessService.can(code, activeBranchId, module) for HOSPITAL callers. */
export const RequirePermission = (
  code: string,
  options?: RequirePermissionOptions,
): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRE_PERMISSION_KEY, {
    code,
    module: options?.module,
  } satisfies RequirePermissionMeta);

/**
 * Explicit marker: any signed-in user of the allowed token kinds; no permission check.
 * Routes with none of @Public / @AuthenticatedOnly / @RequirePermission are denied.
 */
export const AuthenticatedOnly = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATED_ONLY_KEY, true);
