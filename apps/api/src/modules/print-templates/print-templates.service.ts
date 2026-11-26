import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { AccessService } from '../access/access.service';
import { assertMayChangePrint, type PrintScope } from './print-scope';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import type { Actor } from '../opd-visits/opd-visits.service';
import {
  defaultInput,
  type DefaultPaper,
  DEFAULT_PAPERS,
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

export type { PrintScope };

/** `scope` of a request: nothing given means the whole hospital (as before Step 8c). */
export function parseScope(raw: unknown): PrintScope {
  if (raw === undefined || raw === '') {
    return 'hospital';
  }
  if (raw === 'branch' || raw === 'hospital') {
    return raw;
  }
  throw opdError(400, OpdErrorCode.PRINT_SCOPE_INVALID);
}

export type EffectiveTemplate = PrintTemplateInput & {
  docType: PrintDocType;
  /** CUSTOM: a branch or the hospital saved it. DEFAULT: nothing saved, the built-in default applies. */
  source: 'CUSTOM' | 'DEFAULT';
  /** Which one applies: the branch's own, the hospital's, or the built-in default. */
  scope: 'BRANCH' | 'HOSPITAL' | 'DEFAULT';
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

/** The hospital's default paper (a setting); A5 when nothing is saved yet. */
async function defaultPaperOf(tx: TenantTx, tenantId: string): Promise<DefaultPaper> {
  const row = await tx.opdSettings.findUnique({
    where: { tenantId },
    select: { defaultPrintPaper: true },
  });
  const paper = row?.defaultPrintPaper;
  return (DEFAULT_PAPERS as readonly string[]).includes(paper ?? '')
    ? (paper as DefaultPaper)
    : 'A5';
}

function effective(
  docType: PrintDocType,
  input: PrintTemplateInput,
  scope: 'BRANCH' | 'HOSPITAL' | 'DEFAULT',
  updatedAt: Date | null,
): EffectiveTemplate {
  const page = pageSizeMm(input);
  return {
    docType,
    source: scope === 'DEFAULT' ? 'DEFAULT' : 'CUSTOM',
    scope,
    ...input,
    pageWidthMm: page.widthMm,
    pageHeightMm: page.heightMm,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
  };
}

/**
 * Step 7-3 and Step 8c: print templates. Every signed-in staff member can READ the template of a
 * document (the print screens need it). What applies to a branch is looked up in this order: the
 * branch's own template, then the hospital's, then the built-in default of the code. The settings
 * permission can CHANGE a template: the template of the SIGNED-IN branch (scope branch, the branch
 * comes from the token, never from the request) or, only for a person who holds the permission in
 * every branch (a SuperAdmin), the hospital's template (scope hospital). Resetting removes only the
 * template of the chosen scope. Every change is audited with the names of what changed, never the
 * header or footer text itself.
 */
@Injectable()
export class PrintTemplatesService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly access: AccessService,
  ) {}

  private assertMayChange(actor: Actor, scope: PrintScope): Promise<void> {
    return assertMayChangePrint(this.access, actor, scope);
  }

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

  async list(actor: Actor): Promise<{
    items: EffectiveTemplate[];
    /** What the caller may change here: this branch's templates, and the hospital's. */
    canChange: { branch: boolean; hospital: boolean };
  }> {
    const [canBranch, canHospital] = await Promise.all([
      this.access.can('opd.settings.write', actor.branchId, 'OPD'),
      this.access
        .hospitalWideBranches('opd.settings.write', 'OPD')
        .then((branches) => branches.length > 0),
    ]);
    return this.tenantDb.withTenant(async (tx) => {
      const rows = await this.rowsFor(tx, actor);
      const paper = await defaultPaperOf(tx, actor.tenantId);
      return {
        items: PRINT_DOC_TYPES.map((docType) =>
          this.effectiveIn(docType, rows, actor.branchId, paper),
        ),
        canChange: { branch: canBranch, hospital: canHospital },
      };
    });
  }

  async getOne(actor: Actor, docType: PrintDocType): Promise<EffectiveTemplate> {
    return this.tenantDb.withTenant((tx) => this.readOne(tx, actor, docType));
  }

  async save(
    actor: Actor,
    docType: PrintDocType,
    body: unknown,
    scope: PrintScope = 'hospital',
  ): Promise<EffectiveTemplate> {
    await this.assertMayChange(actor, scope);
    const input = validateTemplate(docType, body);
    const branchId = scope === 'branch' ? actor.branchId : null;
    return this.tenantDb.withTenant(async (tx) => {
      const where = { tenantId: actor.tenantId, branchId, docType, retiredAt: null };
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
          data: { tenantId: actor.tenantId, branchId, docType, createdBy: actor.userId, ...data },
        });
      }
      // What a change means is judged against the template that applied to that scope before: its own
      // saved one, else (for a branch) the hospital's, else the built-in default.
      const rows = await this.rowsFor(tx, actor);
      const previous =
        existing ??
        (branchId ? rows.find((r) => r.docType === docType && r.branchId === null) : undefined);
      const before = previous
        ? rowToInput(previous, docType)
        : defaultInput(docType, await defaultPaperOf(tx, actor.tenantId));
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
          metadata: { docType, scope, created, changed },
        },
      });
      return this.readOne(tx, actor, docType);
    });
  }

  /** Two first saves at the same moment: the second one loses the race and simply updates. */
  async saveWithRetry(
    actor: Actor,
    docType: PrintDocType,
    body: unknown,
    scope: PrintScope = 'hospital',
  ): Promise<EffectiveTemplate> {
    try {
      return await this.save(actor, docType, body, scope);
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      return this.save(actor, docType, body, scope);
    }
  }

  /**
   * Removes the saved template of the chosen scope only (the audit log keeps the history). Resetting a
   * branch falls back to the hospital's template; resetting the hospital's falls back to the built-in
   * default (branches with their own template keep it).
   */
  async reset(
    actor: Actor,
    docType: PrintDocType,
    scope: PrintScope = 'hospital',
  ): Promise<EffectiveTemplate> {
    await this.assertMayChange(actor, scope);
    const branchId = scope === 'branch' ? actor.branchId : null;
    return this.tenantDb.withTenant(async (tx) => {
      const removed = await tx.printTemplate.deleteMany({
        where: { tenantId: actor.tenantId, branchId, docType, retiredAt: null },
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
            metadata: { docType, scope },
          },
        });
      }
      return this.readOne(tx, actor, docType);
    });
  }

  // ------------------------------------------------------------------------------- helpers

  /** The hospital's templates and the ones of the signed-in branch (never another branch's). */
  private rowsFor(tx: TenantTx, actor: Actor) {
    return tx.printTemplate.findMany({
      where: {
        tenantId: actor.tenantId,
        retiredAt: null,
        OR: [{ branchId: null }, { branchId: actor.branchId }],
      },
    });
  }

  private async readOne(tx: TenantTx, actor: Actor, docType: PrintDocType) {
    const rows = await tx.printTemplate.findMany({
      where: {
        tenantId: actor.tenantId,
        docType,
        retiredAt: null,
        OR: [{ branchId: null }, { branchId: actor.branchId }],
      },
    });
    return this.effectiveIn(
      docType,
      rows,
      actor.branchId,
      await defaultPaperOf(tx, actor.tenantId),
    );
  }

  /** The lookup: the branch's own template, then the hospital's, then the built-in default. */
  private effectiveIn(
    docType: PrintDocType,
    rows: Array<Prisma.PrintTemplateGetPayload<object>>,
    branchId: string,
    paper: DefaultPaper = 'A5',
  ): EffectiveTemplate {
    const ofDoc = rows.filter((r) => r.docType === docType);
    const own = ofDoc.find((r) => r.branchId === branchId);
    const wide = ofDoc.find((r) => r.branchId === null);
    if (own) {
      return effective(docType, rowToInput(own, docType), 'BRANCH', own.updatedAt);
    }
    if (wide) {
      return effective(docType, rowToInput(wide, docType), 'HOSPITAL', wide.updatedAt);
    }
    return effective(docType, defaultInput(docType, paper), 'DEFAULT', null);
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
