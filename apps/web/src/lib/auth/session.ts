import { cookies, headers } from 'next/headers';
import { sessionConfig } from '@/config/session';
import { fetchMe } from './api-client';
import type { AuthKind, AuthMeProfile } from './types';

export type SessionResult = AuthMeProfile;

/**
 * Reads the access cookie and calls API GET /auth/me.
 * Does not decode or verify JWTs in the web app.
 */
export async function getSession(): Promise<SessionResult | null> {
  const jar = await cookies();
  const access = jar.get(sessionConfig.cookieAccessName)?.value;
  if (!access) {
    return null;
  }
  const headersList = await headers();
  const proto = headersList.get('x-forwarded-proto') ?? 'http';
  const host = headersList.get('x-forwarded-host') ?? headersList.get('host') ?? '127.0.0.1';
  const synthetic = new Request(`${proto}://${host}/`, {
    headers: {
      'x-forwarded-for': headersList.get('x-forwarded-for') ?? '',
      'x-real-ip': headersList.get('x-real-ip') ?? '',
    },
  });
  const result = await fetchMe(synthetic, access);
  if (!result.ok) {
    return null;
  }
  return result.data;
}

export async function getRefreshCookie(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(sessionConfig.cookieRefreshName)?.value;
}

export async function currentPathname(): Promise<string> {
  const headersList = await headers();
  return headersList.get('x-pathname') ?? sessionConfig.loginPath;
}

export function homeForKind(kind: AuthKind): string {
  return kind === 'HQ' ? sessionConfig.homeHq : sessionConfig.homeHospital;
}
