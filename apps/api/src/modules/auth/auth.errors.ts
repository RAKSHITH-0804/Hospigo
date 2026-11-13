import { UnauthorizedException } from '@nestjs/common';

/** Identical client-facing auth failure for every login/refresh rejection case. */
export const AUTH_FAILED_MESSAGE = 'Authentication failed';

export function authFailed(): never {
  throw new UnauthorizedException({
    statusCode: 401,
    message: AUTH_FAILED_MESSAGE,
    error: 'Unauthorized',
  });
}
