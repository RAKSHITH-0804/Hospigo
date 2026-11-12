/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { buildRequestHeadersWithPathname } from '@/lib/auth/pathname-header';
import { middleware } from './middleware';

describe('middleware x-pathname', () => {
  it('overwrites any client-supplied x-pathname with request.nextUrl.pathname', () => {
    const request = new NextRequest('http://127.0.0.1:3001/admin/staff', {
      headers: { 'x-pathname': '/evil/forged' },
    });
    const headers = buildRequestHeadersWithPathname(request);
    expect(headers.get('x-pathname')).toBe('/admin/staff');
    expect(headers.get('x-pathname')).not.toBe('/evil/forged');

    // middleware wires the helper into NextResponse.next
    const response = middleware(request);
    expect(response).toBeDefined();
  });
});
