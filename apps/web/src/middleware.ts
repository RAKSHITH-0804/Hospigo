import { NextResponse, type NextRequest } from 'next/server';
import { buildRequestHeadersWithPathname } from '@/lib/auth/pathname-header';

/**
 * Forward pathname so server layouts can build refresh `next=` targets.
 * Never trusts a client-supplied `x-pathname` (see buildRequestHeadersWithPathname).
 */
export function middleware(request: NextRequest) {
  return NextResponse.next({
    request: { headers: buildRequestHeadersWithPathname(request) },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
