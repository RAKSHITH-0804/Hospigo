import { NextResponse } from 'next/server';
import { assertOrigin } from '@/lib/auth/http';
import { staffRoute } from '@/lib/auth/staff-route';
import { proxyOpdWrite } from '@/lib/opd/route-write';
import { PRINT_DOC_TYPES, type PrintDocType } from '@/lib/print/types';

type Context = { params: Promise<{ docType: string }> };

function badDocType(): NextResponse {
  return NextResponse.json(
    { code: 'PRINT_DOC_TYPE_INVALID' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** The scope of the URL: none, branch or hospital. Anything else is refused here already. */
function scopeOf(request: Request): { ok: true; query: string } | { ok: false } {
  const all = new URL(request.url).searchParams.getAll('scope');
  if (all.length === 0) {
    return { ok: true, query: '' };
  }
  if (all.length === 1 && (all[0] === 'branch' || all[0] === 'hospital')) {
    return { ok: true, query: `?scope=${all[0]}` };
  }
  return { ok: false };
}

function badScope(): NextResponse {
  return NextResponse.json(
    { code: 'PRINT_SCOPE_INVALID' },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  );
}

async function docTypeOf(context: Context): Promise<PrintDocType | null> {
  const { docType } = await context.params;
  return (PRINT_DOC_TYPES as readonly string[]).includes(docType)
    ? (docType as PrintDocType)
    : null;
}

/**
 * PUT /api/staff/print-templates/:docType?scope=branch|hospital: save the template of one document.
 * The API checks the permission (opd.settings.write, and for the hospital scope the permission in
 * every branch), the OPD module and every value; the answer is the template that applies afterwards.
 */
export async function PUT(request: Request, context: Context) {
  const docType = await docTypeOf(context);
  if (!docType) {
    return badDocType();
  }
  const scope = scopeOf(request);
  if (!scope.ok) {
    return badScope();
  }
  return proxyOpdWrite(request, 'PUT', `/print-templates/${docType}${scope.query}`);
}

/** DELETE /api/staff/print-templates/:docType?scope=...: removes the template of that scope (the answer is what applies next). */
export async function DELETE(request: Request, context: Context) {
  const docType = await docTypeOf(context);
  if (!docType) {
    return badDocType();
  }
  const originError = assertOrigin(request);
  if (originError) {
    return originError;
  }
  const scope = scopeOf(request);
  if (!scope.ok) {
    return badScope();
  }
  return staffRoute({
    method: 'DELETE',
    request,
    path: `/print-templates/${docType}${scope.query}`,
  });
}
