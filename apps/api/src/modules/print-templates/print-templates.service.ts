import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import type { Actor } from '../opd-visits/opd-visits.service';
import {
  defaultInput,
  PRESETS,
  PRINT_DOC_TYPES,
  pageSizeMm,
  presetInput,
  validateTemplate,
  type PrintDocType,
  type PrintTemplateInput,
} from './print-template.rules';

export const PRINT_TEMPLATE_AUDIT = {
  updated: 'PRINT_TEMPLATE_UPDATE',
  reset: 'PRINT_TEMPLATE_RESET',
} as const;

export type EffectiveTemplate = PrintTemplateInput & {
  docType: PrintDocType;
  /** CUSTOM: the hospital saved it. DEFAULT: nothing saved, the built-in default applies. */
  source: 'CUSTOM' | 'DEFAULT';
  /** The real page size in millimetres (a landscape A4 is 297 wide). */
  pageWidthMm: number;
  pageHeightMm: number;
  updatedAt: string | null;
};

const TOP_LEVEL = [
  'enabled',
  'preset',
  'paper',
  'widthMm',
  'heightMm',
  'orientation',
  'margins',
  'mode',
  'layout',
] as const;

/** `docType` of a URL: exactly one of the three documents, else a clean 400. */
export function parseDocType(raw: string): PrintDocType {
  if ((PRINT_DOC_TYPES as readonly string[]).includes(raw)) {
    return raw as PrintDocType;
  }
  throw opdError(400, OpdErrorCode.PRINT_DOC_TYPE_INVALID);
}

function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: { code?: unknown } } | null;
  return (
    e?.code === 'P2002' ||
    e?.code === '23505' ||
    e?.cause?.code === '23505' ||
    (typeof e?.message === 'string' && /duplicate key|unique constraint/i.test(e.message))
  );
}

const asNumber = (d: { toString(): string } | null): number | null =>
  d === null ? null : Number(d.toString());

function rowToInput(
  row: Prisma.PrintTemplateGetPayload<object>,
  docType: PrintDocType,
): PrintTemplateInput {
  try {
    // The stored layout was validated when it was saved; this makes sure a hand-edited row can
    // never reach a printer in a shape the screens do not expect.
    return validateTemplate(docType, {
      enabled: row.enabled,
      preset: row.preset,
      paper: row.paper,
      widthMm: asNumber(row.widthMm),
      heightMm: asNumber(row.heightMm),
      orientation: row.orientation,
      margins: {
        topMm: asNumber(row.marginTopMm),
        rightMm: asNumber(row.marginRightMm),
        bottomMm: asNumber(row.marginBottomMm),
        leftMm: asNumber(row.marginLeftMm),
      },
      mode: row.mode,
      layout: row.layout,
    });
  } catch {
    return { ...defaultInput(docType), enabled: row.enabled };
  }
}

function effective(
  docType: PrintDocType,
  input: PrintTemplateInput,
  source: 'CUSTOM' | 'DEFAULT',
  updatedAt: Date | null,
): EffectiveTemplate {
  const page = pageSizeMm(input);
  return {
    docType,
    source,
    ...input,
    pageWidthMm: page.widthMm,
    pageHeightMm: page.heightMm,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

/**
 * Step 7-3: print templates. Every signed-in staff member can READ the template of a document (the
 * print screens need it) and the hospital's settings permission can CHANGE it. A hospital that never
 * saved a template gets the built-in default of the code. Hospital-wide only for now (the branch
 * column of the table is for later). Every change is audited with the names of what changed, never
 * the header or footer text itself.
 */
@Injectable()
export class PrintTemplatesService {
  constructor(private readonly tenantDb: TenantDb) {}

  /** The built-in presets with what each one gives each document (the screen copies, then adjusts). */
  presets() {
    return {
      items: Object.entries(PRESETS).map(([key, preset]) => ({
        key,
        name: preset.name,
        templates: Object.fromEntries(
          PRINT_DOC_TYPES.map((docType) => [
            docType,
            effective(docType, presetInput(key, docType), 'DEFAULT', null),
          ]),
        ),
      })),
    };
  }

  async list(actor: Actor): Promise<{ items: EffectiveTemplate[] }> {
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await tx.printTemplate.findMany({
        where: { tenantId: actor.tenantId, branchId: null },
      });
      return {
        items: PRINT_DOC_TYPES.map((docType) => this.effectiveIn(docType, rows)),
      };
    });
  }

  async getOne(actor: Actor, docType: PrintDocType): Promise<EffectiveTemplate> {
    return this.tenantDb.withTenant((tx) => this.readOne(tx, actor.tenantId, docType));
  }

  async save(actor: Actor, docType: PrintDocType, body: unknown): Promise<EffectiveTemplate> {
    const input = validateTemplate(docType, body);
    return this.tenantDb.withTenant(async (tx) => {
      const where = { tenantId: actor.tenantId, branchId: null, docType };
      const existing = await tx.printTemplate.findFirst({ where });
      const data = this.toData(input, actor.userId);
      let created = false;
      if (existing) {
        await tx.printTemplate.updateMany({
          where: { id: existing.id, tenantId: actor.tenantId },
          data,
        });
      } else {
        created = true;
        await tx.printTemplate.create({
          data: { tenantId: actor.tenantId, docType, createdBy: actor.userId, ...data },
        });
      }
      const before = existing ? rowToInput(existing, docType) : defaultInput(docType);
      const changed = TOP_LEVEL.filter(
        (key) => JSON.stringify(before[key]) !== JSON.stringify(input[key]),
      );
      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          branchId: actor.branchId,
          action: PRINT_TEMPLATE_AUDIT.updated,
          entityType: 'print_template',
          entityId: docType,
          // Names of what changed, never the texts typed into the header or footer.
          metadata: { docType, created, changed },
        },
      });
      return this.readOne(tx, actor.tenantId, docType);
    });
  }

  /** Two first saves at the same moment: the second one loses the race and simply updates. */
  async saveWithRetry(
    actor: Actor,
    docType: PrintDocType,
    body: unknown,
  ): Promise<EffectiveTemplate> {
    try {
      return await this.save(actor, docType, body);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.save(actor, docType, body);
    }
  }

  /** Goes back to the built-in default (the saved row is removed; the audit log keeps the history). */
  async reset(actor: Actor, docType: PrintDocType): Promise<EffectiveTemplate> {
    return this.tenantDb.withTenant(async (tx) => {
      const removed = await tx.printTemplate.deleteMany({
        where: { tenantId: actor.tenantId, branchId: null, docType },
      });
      if (removed.count > 0) {
        await tx.auditLog.create({
          data: {
            tenantId: actor.tenantId,
            actorUserId: actor.userId,
            branchId: actor.branchId,
            action: PRINT_TEMPLATE_AUDIT.reset,
            entityType: 'print_template',
            entityId: docType,
            metadata: { docType },
          },
        });
      }
      return this.readOne(tx, actor.tenantId, docType);
    });
  }

  // ------------------------------------------------------------------------------- helpers

  private async readOne(tx: TenantTx, tenantId: string, docType: PrintDocType) {
    const rows = await tx.printTemplate.findMany({ where: { tenantId, branchId: null, docType } });
    return this.effectiveIn(docType, rows);
  }

  private effectiveIn(
    docType: PrintDocType,
    rows: Array<Prisma.PrintTemplateGetPayload<object>>,
  ): EffectiveTemplate {
    const row = rows.find((r) => r.docType === docType);
    return row
      ? effective(docType, rowToInput(row, docType), 'CUSTOM', row.updatedAt)
      : effective(docType, defaultInput(docType), 'DEFAULT', null);
  }

  private toData(input: PrintTemplateInput, userId: string) {
    return {
      enabled: input.enabled,
      preset: input.preset,
      paper: input.paper,
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      orientation: input.orientation,
      marginTopMm: input.margins.topMm,
      marginRightMm: input.margins.rightMm,
      marginBottomMm: input.margins.bottomMm,
      marginLeftMm: input.margins.leftMm,
      mode: input.mode,
      layout: input.layout as unknown as Prisma.InputJsonValue,
      updatedBy: userId,
      updatedAt: new Date(),
    };
  }
}
