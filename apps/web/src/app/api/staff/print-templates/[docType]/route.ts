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

async function docTypeOf(context: Context): Promise<PrintDocType | null> {
  const { docType } = await context.params;
  return (PRINT_DOC_TYPES as readonly string[]).includes(docType)
    ? (docType as PrintDocType)
    : null;
}

/**
 * PUT /api/staff/print-templates/:docType: save the template of one document. The API checks the
 * permission (opd.settings.write), the OPD module and every value; the answer is the saved template.
 */
export async function PUT(request: Request, context: Context) {
  const docType = await docTypeOf(context);
  if (!docType) {
    return badDocType();
  }
  return proxyOpdWrite(request, 'PUT', `/print-templates/${docType}`);
}

/** DELETE /api/staff/print-templates/:docType: back to the built-in default (the answer is that default). */
export async function DELETE(request: Request, context: Context) {
  const docType = await docTypeOf(context);
  if (!docType) {
    return badDocType();
  }
  const originError = assertOrigin(request);
  if (originError) {
    return originError;
  }
  return staffRoute({ method: 'DELETE', request, path: `/print-templates/${docType}` });
}
