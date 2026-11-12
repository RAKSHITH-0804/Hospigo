import type { NextResponse } from 'next/server';
import { cookieSecure, sessionConfig } from '@/config/session';

export function accessCookieOptions(expiresInSec: number) {
  return {
    httpOnly: true as const,
    secure: cookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: expiresInSec,
  };
}

export function refreshCookieOptions() {
  return {
    httpOnly: true as const,
    secure: cookieSecure(),
    sameSite: 'lax' as const,
    path: sessionConfig.refreshCookiePath,
    maxAge: sessionConfig.refreshMaxAgeSec,
  };
}

export function changeCookieOptions() {
  return {
    httpOnly: true as const,
    secure: cookieSecure(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: sessionConfig.changePasswordMaxAgeSec,
  };
}

/** Clear all auth cookies on a NextResponse (login/logout/refresh failure). */
export function applyClearCookies(response: NextResponse): void {
  const secure = cookieSecure();
  const base = { httpOnly: true, secure, sameSite: 'lax' as const, maxAge: 0 };
  response.cookies.set(sessionConfig.cookieAccessName, '', { ...base, path: '/' });
  response.cookies.set(sessionConfig.cookieChangeName, '', { ...base, path: '/' });
  response.cookies.set(sessionConfig.cookieRefreshName, '', {
    ...base,
    path: sessionConfig.refreshCookiePath,
  });
  response.cookies.set(sessionConfig.cookieRefreshName, '', { ...base, path: '/' });
}

export function applySessionCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
): void {
  response.cookies.set(
    sessionConfig.cookieAccessName,
    tokens.accessToken,
    accessCookieOptions(tokens.expiresIn),
  );
  response.cookies.set(
    sessionConfig.cookieRefreshName,
    tokens.refreshToken,
    refreshCookieOptions(),
  );
  response.cookies.set(sessionConfig.cookieChangeName, '', {
    ...changeCookieOptions(),
    maxAge: 0,
  });
}

export function applyChangePasswordCookie(
  response: NextResponse,
  accessToken: string,
  expiresIn: number,
): void {
  response.cookies.set(sessionConfig.cookieChangeName, accessToken, {
    ...changeCookieOptions(),
    maxAge: Math.min(expiresIn, sessionConfig.changePasswordMaxAgeSec),
  });
}
