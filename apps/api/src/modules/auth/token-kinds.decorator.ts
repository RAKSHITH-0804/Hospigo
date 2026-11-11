import { SetMetadata } from '@nestjs/common';
import type { AccessTokenType } from './token.types';

export const TOKEN_KINDS_KEY = 'auth:tokenKinds';

/**
 * Restrict which access-token types may call this route.
 * CHANGE_PASSWORD_* tokens are refused unless explicitly listed.
 */
export const TokenKinds = (...kinds: AccessTokenType[]): MethodDecorator & ClassDecorator =>
  SetMetadata(TOKEN_KINDS_KEY, kinds);
