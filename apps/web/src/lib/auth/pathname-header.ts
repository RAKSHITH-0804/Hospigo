import type { NextRequest } from 'next/server';

/**
 * Build request headers for downstream RSC/route code.
 * Always discards any client-supplied `x-pathname` and sets it from
 * `request.nextUrl.pathname` only.
 */
export function buildRequestHeadersWithPathname(request: NextRequest): Headers {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-pathname');
  requestHeaders.set('x-pathname', request.nextUrl.pathname);
  return requestHeaders;
}
