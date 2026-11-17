import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { BranchSwitchErrorCode, branchSwitchConfig } from '@/config/branch-switch';
import { sessionConfig } from '@/config/session';
import { refreshTokens, switchBranchUpstream } from '@/lib/auth/api-client';
import { applyClearCookies, applySessionCookies } from '@/lib/auth/cookies';
import { assertJsonContentType, assertOrigin, readJsonBody } from '@/lib/auth/http';
import { flightTokens, runRefreshSingleFlight, type FlightResult } from '@/lib/auth/refresh-flight';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

function json(code: string | undefined, status: number, extra?: HeadersInit): NextResponse {
  const headers = new Headers(NO_STORE);
  new Headers(extra).forEach((value, key) => headers.set(key, value));
  return NextResponse.json(code ? { ok: false, code } : { ok: true }, { status, headers });
}

function sessionDead(): NextResponse {
  const response = json(BranchSwitchErrorCode.SESSION_EXPIRED, 401);
  applyClearCookies(response);
  return response;
}

function failureResponse(result: Extract<FlightResult, { ok: false }>): NextResponse {
  const status = result.status;
  let response: NextResponse;
  if (status === 401) {
    return sessionDead();
  } else if (status === 403) {
    response = json(BranchSwitchErrorCode.FORBIDDEN, 403);
  } else if (status === 404) {
    response = json(BranchSwitchErrorCode.BRANCH_NOT_AVAILABLE, 404);
  } else if (status === 400) {
    const same = result.message === branchSwitchConfig.upstreamSameBranchMessage;
    response = json(
      same ? BranchSwitchErrorCode.SAME_BRANCH : BranchSwitchErrorCode.VALIDATION,
      400,
    );
  } else if (status === branchSwitchConfig.conflictStatus) {
    response = json(BranchSwitchErrorCode.SWITCH_IN_PROGRESS, branchSwitchConfig.conflictStatus);
  } else if (status === 429) {
    response = json(
      BranchSwitchErrorCode.RATE_LIMITED,
      429,
      result.retryAfter ? { 'Retry-After': result.retryAfter } : undefined,
    );
  } else if (status === 502 || status === 503 || status === 0) {
    response = json(BranchSwitchErrorCode.UNAVAILABLE, status === 502 ? 502 : 503);
  } else {
    response = json(BranchSwitchErrorCode.UNKNOWN, 500);
  }
  // A refused switch has still rotated the session (the refresh step): hand the browser the
  // new cookies, or its next refresh would present a spent token and look like reuse.
  const rotated = flightTokens(result);
  if (rotated) {
    applySessionCookies(response, rotated);
  }
  return response;
}

/**
 * POST /api/auth/switch-branch  { branchId }
 * Hospital-wide users only (the API decides). Same-origin JSON; never redirects; tokens only in
 * httpOnly cookies. The refresh cookie path is /api/auth, so this route can read it.
 *
 * Runs through the SAME single-flight as silent renewal (refresh-flight.ts): a switch and a
 * refresh on one cookie can never both present the same refresh token to the API.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const originError = assertOrigin(request);
  if (originError) {
    return originError;
  }
  const ctError = assertJsonContentType(request);
  if (ctError) {
    return ctError;
  }
  const body = await readJsonBody(request);
  if (!body.ok) {
    return body.response;
  }
  const branchId =
    typeof body.value === 'object' && body.value !== null
      ? (body.value as { branchId?: unknown }).branchId
      : undefined;
  if (
    typeof branchId !== 'string' ||
    branchId.length === 0 ||
    branchId.length > branchSwitchConfig.branchIdMaxLength
  ) {
    return json(BranchSwitchErrorCode.VALIDATION, 400);
  }

  const jar = await cookies();
  const refresh = jar.get(sessionConfig.cookieRefreshName)?.value;
  if (!refresh) {
    return sessionDead();
  }

  const result = await runRefreshSingleFlight(
    refresh,
    async (start) => {
      let tokens = start;
      if (!tokens) {
        // A fresh access token is needed for the switch call, and it keeps the session alive.
        const renewed = await refreshTokens(request, refresh);
        if (!renewed.ok) {
          return {
            ok: false as const,
            status: renewed.status,
            retryAfter: renewed.retryAfter,
          };
        }
        if (!renewed.data.refreshToken) {
          return { ok: false as const, status: 502 };
        }
        tokens = {
          accessToken: renewed.data.accessToken,
          refreshToken: renewed.data.refreshToken,
          expiresIn: renewed.data.expiresIn,
        };
      }
      const switched = await switchBranchUpstream(request, tokens.accessToken, {
        branchId,
        refreshToken: tokens.refreshToken as string,
      });
      if (switched.ok && switched.data.refreshToken) {
        return {
          ok: true as const,
          data: {
            accessToken: switched.data.accessToken,
            refreshToken: switched.data.refreshToken,
            expiresIn: switched.data.expiresIn,
          },
        };
      }
      const status = switched.ok ? 502 : switched.status;
      return {
        ok: false as const,
        status,
        retryAfter: switched.ok ? undefined : switched.retryAfter,
        message: switched.ok ? undefined : switched.message,
        // 401 from the API means the session is gone (reuse or expiry): no cookies to keep.
        tokens: status === 401 ? undefined : tokens,
      };
    },
    'staff',
    `switch:${branchId}`,
  );

  if (!result.ok) {
    return failureResponse(result);
  }
  const rotated = flightTokens(result);
  if (!rotated) {
    return json(BranchSwitchErrorCode.UNAVAILABLE, 502);
  }
  const response = json(undefined, 200);
  applySessionCookies(response, rotated);
  return response;
}
