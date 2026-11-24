import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import { Prisma } from '../../generated/prisma';
import { AccessService } from '../access/access.service';
import { PricesService } from '../opd-prices/prices.service';
import type { Actor } from '../opd-visits/opd-visits.service';
import { OpdErrorCode, opdError } from '../opd-visits/opd-visit.errors';
import { STORAGE_SERVICE, StorageService } from '../storage/storage.service';
import { ImportBatchService } from './import-batch.service';
import {
  IMPORT_AUDIT,
  IMPORT_COLUMNS,
  IMPORT_LIMITS,
  IMPORT_PRICE_TYPES,
  IMPORT_SAMPLE_ROWS,
  IMPORT_TEMPLATE_VERSION,
  IMPORT_TYPE_CODES,
  isImportType,
  type ImportTypeCode,
} from './import.config';
import { loadContext, prepareRows, type PreparedRow, type RowData } from './import-processors';
import { ImportFileError, inspectXlsx, readSheet } from './xlsx-file';

export type BatchView = {
  id: string;
  type: ImportTypeCode;
  status: string;
  /** PREVIEWING or POSTING while a background run is going; FAILED, CANCELLED or POST_FAILED after. */
  runStatus: string | null;
  /** True when a background run has been going for so long that it can be started again. */
  runStale: boolean;
  fileName: string;
  totalRows: number;
  validRows: number;
  exceptionRows: number;
  /** Valid rows that change nothing (the data is already as the file says). */
  unchangedRows: number;
  postedRows: number;
  errorMessage: string | null;
  createdAt: string;
  createdByName: string | null;
  approvedAt: string | null;
  postedAt: string | null;
};

export type RowView = {
  rowNumber: number;
  matchKey: string;
  status: string;
  action: string | null;
  values: Record<string, string | number | boolean | null>;
  reason: string | null;
  field: string | null;
};

/** The data changed after the preview, so what was approved can no longer be saved as it was. */
class ImportStaleError extends Error {
  constructor(
    public readonly reason: string,
    public readonly rowNumber: number | null,
  ) {
    super(reason);
  }
}

const SAFE_NAME = /[^\p{L}\p{N} ._()-]/gu;

function cleanFileName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(SAFE_NAME, '_').trim().slice(0, 120);
  return cleaned === '' ? 'upload.xlsx' : cleaned;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Step 8b, part C: Excel upload of tests (with prices), doctor fees and medicines.
 *
 * The existing batch engine keeps the steps (DRAFT, PREVIEWED, APPROVED, POSTED); this service adds
 * the file, the preview, the checks and the saving. The file is read in the background and its
 * status is on the batch. Nothing reaches the masters before "post", and "post" saves everything in
 * ONE transaction: if the data changed since the preview, nothing is saved. A posted batch is final
 * (prices are never deleted): a correction is a new upload.
 */
@Injectable()
export class ImportsService {
  private readonly pending = new Set<Promise<void>>();

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly engine: ImportBatchService,
    private readonly access: AccessService,
    private readonly prices: PricesService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Waits for the background runs that are going (used by tests and a clean shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  private track(run: Promise<void>): void {
    this.pending.add(run);
    void run.finally(() => this.pending.delete(run));
  }

  // ----------------------------------------------------------------------------- permission

  private async assertMayUse(actor: Actor, type: ImportTypeCode): Promise<void> {
    // The route needs opd.masters.write; prices are a second permission.
    if (
      IMPORT_PRICE_TYPES.includes(type) &&
      !(await this.access.can('opd.prices.write', actor.branchId, 'OPD'))
    ) {
      throw opdError(403, OpdErrorCode.FORBIDDEN);
    }
  }

  // ---------------------------------------------------------------------------- templates

  async template(typeCode: string): Promise<Buffer> {
    if (!isImportType(typeCode)) {
      throw opdError(404, OpdErrorCode.IMPORT_NOT_FOUND);
    }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    const columns = IMPORT_COLUMNS[typeCode];
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: 24 }));
    sheet.getRow(1).font = { bold: true };
    for (const sample of IMPORT_SAMPLE_ROWS[typeCode]) {
      const row: Record<string, ExcelJS.CellValue> = {};
      for (const c of columns) {
        const v = sample[c.key] ?? '';
        if (v === '') {
          // An optional column stays a truly empty cell (an empty text run can upset Excel).
          continue;
        }
        // Text is always written as TEXT (never as a formula); numbers stay numbers.
        row[c.key] = typeof v === 'number' ? v : { richText: [{ text: String(v) }] };
      }
      sheet.addRow(row);
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  // -------------------------------------------------------------------------------- upload

  async upload(
    actor: Actor,
    typeCode: string,
    file: { buffer?: Buffer; originalname?: string } | undefined,
  ): Promise<BatchView> {
    if (!isImportType(typeCode)) {
      throw opdError(404, OpdErrorCode.IMPORT_NOT_FOUND);
    }
    await this.assertMayUse(actor, typeCode);
    const buffer = file?.buffer;
    if (!buffer || buffer.length === 0) {
      throw opdError(400, OpdErrorCode.IMPORT_FILE_INVALID, { reason: 'NO_FILE' });
    }
    try {
      if (buffer.length > IMPORT_LIMITS.maxBytes) {
        throw new ImportFileError('TOO_BIG');
      }
      inspectXlsx(buffer);
    } catch (error) {
      if (error instanceof ImportFileError) {
        throw opdError(400, OpdErrorCode.IMPORT_FILE_INVALID, { reason: error.reason });
      }
      throw error;
    }

    const importTypeId = await this.tenantDb.withTenant(async (tx) => {
      const type = await tx.importType.findUnique({ where: { code: typeCode } });
      return type?.isActive ? type.id : null;
    });
    if (!importTypeId) {
      throw opdError(503, OpdErrorCode.IMPORT_NOT_READY);
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const key = `imports/${randomUUID()}.xlsx`;
    await this.storage.put(actor.tenantId, key, buffer);
    let batchId: string;
    try {
      const created = await this.engine.createBatch({
        tenantId: actor.tenantId,
        importTypeId,
        createdBy: actor.userId,
        templateVersion: IMPORT_TEMPLATE_VERSION,
        fileStorageKey: key,
        fileSha256: sha256,
        fileNameOriginal: cleanFileName(file?.originalname),
      });
      batchId = created.id;
    } catch (error) {
      await this.storage.delete(actor.tenantId, key).catch(() => undefined);
      if (/active batch already exists/i.test(errorText(error))) {
        throw opdError(409, OpdErrorCode.IMPORT_DUPLICATE_FILE);
      }
      throw error;
    }
    await this.setRunStatus(batchId, 'PREVIEWING');
    this.track(this.runPreview(actor, batchId, typeCode, buffer));
    return this.getBatch(actor, batchId);
  }

  /**
   * Writes the run status of a batch. With `onlyWhen` it writes only while the batch is still in
   * that status, so a late background run can never overwrite a cancel or a finished post.
   */
  private async setRunStatus(
    batchId: string,
    runStatus: string | null,
    errorMessage?: string | null,
    onlyWhen?: 'DRAFT' | 'PREVIEWED' | 'APPROVED',
  ): Promise<void> {
    await this.tenantDb.withTenant((tx) =>
      tx.importBatch.updateMany({
        where: { id: batchId, ...(onlyWhen ? { status: onlyWhen } : {}) },
        data: { runStatus, ...(errorMessage !== undefined ? { errorMessage } : {}) },
      }),
    );
  }

  // ---------------------------------------------------------------------- the preview run

  /** The background run after an upload: read the file, check every row, keep the result. */
  private async runPreview(
    actor: Actor,
    batchId: string,
    type: ImportTypeCode,
    buffer: Buffer,
  ): Promise<void> {
    try {
      const sheet = await readSheet(buffer, type);
      const now = this.clock.now();
      const feeScope = await this.feeScopeOf();
      const prepared = await this.tenantDb.withTenant(
        async (tx) => {
          const ctx = await loadContext(tx, actor.tenantId, type, sheet, now, feeScope);
          const rows = prepareRows(type, sheet, ctx);
          await this.storeRows(tx, actor.tenantId, batchId, rows);
          return rows;
        },
        { timeoutMs: IMPORT_LIMITS.transactionMs },
      );
      const exceptions = prepared.filter((r) => r.issue !== null).length;
      await this.engine.markPreviewed({
        tenantId: actor.tenantId,
        batchId,
        actorUserId: actor.userId,
        totalRows: prepared.length,
        validRows: prepared.length - exceptions,
        exceptionRows: exceptions,
      });
      await this.setRunStatus(batchId, null, null, 'PREVIEWED');
    } catch (error) {
      await this.failRun(actor, batchId, error);
    }
  }

  private async storeRows(
    tx: TenantTx,
    tenantId: string,
    batchId: string,
    rows: PreparedRow[],
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await tx.importBatchRow.createMany({
      data: rows.map((r) => ({
        tenantId,
        batchId,
        rowNumber: r.rowNumber,
        matchKey: r.matchKey,
        rawValues: r.raw as Prisma.InputJsonValue,
        rowStatus: r.issue ? ('EXCEPTION' as const) : ('VALID' as const),
        action: r.action,
      })),
    });
    const bad = rows.filter((r) => r.issue !== null);
    if (bad.length > 0) {
      const ids = await tx.importBatchRow.findMany({
        where: { tenantId, batchId, rowNumber: { in: bad.map((r) => r.rowNumber) } },
        select: { id: true, rowNumber: true },
      });
      const byNumber = new Map(ids.map((r) => [r.rowNumber, r.id]));
      await tx.importException.createMany({
        data: bad.map((r) => ({
          tenantId,
          batchId,
          rowId: byNumber.get(r.rowNumber)!,
          reasonCode: r.issue!.reason,
          // The column the problem is in; the screen explains the reason in plain words.
          message: r.issue!.field,
          status: 'OPEN' as const,
        })),
      });
    }
  }

  /** A background run that could not finish: the batch ends as FAILED with the reason (a code). */
  private async failRun(actor: Actor, batchId: string, error: unknown): Promise<void> {
    const reason =
      error instanceof ImportFileError
        ? error.detail
          ? `${error.reason}: ${error.detail}`
          : error.reason
        : 'RUN_FAILED';
    try {
      await this.engine.fail({
        tenantId: actor.tenantId,
        batchId,
        actorUserId: actor.userId,
        errorMessage: reason,
      });
    } catch {
      // The batch was cancelled or moved on in the meantime: nothing more to record.
      return;
    }
    await this.deleteStoredFile(actor, batchId);
  }

  /**
   * Step 9: the uploaded file of a batch that ended as FAILED or CANCELLED is no longer needed
   * (nothing was saved; a failed or cancelled batch is never run again), so it is deleted from
   * storage. Never called for a posted batch, and a batch that is not FAILED keeps its file.
   * Best effort: a storage error never changes the batch.
   */
  private async deleteStoredFile(actor: Actor, batchId: string): Promise<void> {
    try {
      const batch = await this.tenantDb.withTenant((tx) =>
        tx.importBatch.findFirst({
          where: { id: batchId, tenantId: actor.tenantId, status: 'FAILED' },
          select: { fileStorageKey: true },
        }),
      );
      if (batch) {
        await this.storage.delete(actor.tenantId, batch.fileStorageKey);
      }
    } catch {
      // Left in storage; nothing else depends on it.
    }
  }

  // ------------------------------------------------------------------------------- queries

  private toView(
    b: Prisma.ImportBatchGetPayload<{ include: { importType: true } }>,
    createdByName: string | null,
    unchangedRows: number,
  ): BatchView {
    const now = this.clock.now().getTime();
    return {
      id: b.id,
      type: b.importType.code as ImportTypeCode,
      status: b.status,
      runStatus: b.runStatus,
      runStale:
        (b.runStatus === 'PREVIEWING' || b.runStatus === 'POSTING') &&
        now - b.updatedAt.getTime() > IMPORT_LIMITS.staleRunMs,
      fileName: b.fileNameOriginal,
      totalRows: b.totalRows,
      validRows: b.validRows,
      exceptionRows: b.exceptionRows,
      unchangedRows,
      postedRows: b.postedRows,
      errorMessage: b.errorMessage,
      createdAt: b.createdAt.toISOString(),
      createdByName,
      approvedAt: b.approvedAt ? b.approvedAt.toISOString() : null,
      postedAt: b.postedAt ? b.postedAt.toISOString() : null,
    };
  }

  async getBatch(actor: Actor, id: string): Promise<BatchView> {
    return this.tenantDb.withTenant(async (tx) => {
      const batch = await tx.importBatch.findFirst({
        where: { id, tenantId: actor.tenantId },
        include: { importType: true },
      });
      if (!batch) {
        throw opdError(404, OpdErrorCode.IMPORT_NOT_FOUND);
      }
      await this.assertMayUse(actor, batch.importType.code as ImportTypeCode);
      const user = await tx.user.findFirst({
        where: { tenantId: actor.tenantId, id: batch.createdBy },
        select: { displayName: true },
      });
      const unchanged = await tx.importBatchRow.count({
        where: {
          tenantId: actor.tenantId,
          batchId: id,
          rowStatus: { in: ['VALID', 'POSTED'] },
          action: 'NONE',
        },
      });
      return this.toView(batch, user?.displayName ?? null, unchanged);
    });
  }

  async list(
    actor: Actor,
    query: { page: number; pageSize: number },
  ): Promise<{ items: BatchView[]; total: number; page: number; pageSize: number }> {
    // The price types are hidden from people who may not change prices.
    const mayPrice = await this.access.can('opd.prices.write', actor.branchId, 'OPD');
    const where: Prisma.ImportBatchWhereInput = {
      tenantId: actor.tenantId,
      importType: {
        code: { in: IMPORT_TYPE_CODES.filter((t) => mayPrice || !IMPORT_PRICE_TYPES.includes(t)) },
      },
    };
    return this.tenantDb.withTenant(async (tx) => {
      const [total, batches] = await Promise.all([
        tx.importBatch.count({ where }),
        tx.importBatch.findMany({
          where,
          include: { importType: true },
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      const users = await tx.user.findMany({
        where: {
          tenantId: actor.tenantId,
          id: { in: [...new Set(batches.map((b) => b.createdBy))] },
        },
        select: { id: true, displayName: true },
      });
      const names = new Map(users.map((u) => [u.id, u.displayName]));
      return {
        items: batches.map((b) => this.toView(b, names.get(b.createdBy) ?? null, 0)),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async rows(
    actor: Actor,
    id: string,
    query: { status?: 'EXCEPTION' | 'VALID' | 'POSTED'; page: number; pageSize: number },
  ): Promise<{ items: RowView[]; total: number; page: number; pageSize: number }> {
    await this.getBatch(actor, id);
    return this.tenantDb.withTenant(async (tx) => {
      const where: Prisma.ImportBatchRowWhereInput = {
        tenantId: actor.tenantId,
        batchId: id,
        ...(query.status ? { rowStatus: query.status } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.importBatchRow.count({ where }),
        tx.importBatchRow.findMany({
          where,
          orderBy: { rowNumber: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          include: { exceptions: { take: 1, orderBy: { createdAt: 'asc' } } },
        }),
      ]);
      return {
        items: rows.map((r) => ({
          rowNumber: r.rowNumber,
          matchKey: r.matchKey,
          status: r.rowStatus,
          action: r.action,
          values: (r.rawValues ?? {}) as RowView['values'],
          reason: r.exceptions[0]?.reasonCode ?? null,
          field: r.exceptions[0]?.message ?? null,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  // ------------------------------------------------------------------------ approve, cancel

  private async typeOfBatch(actor: Actor, id: string): Promise<ImportTypeCode> {
    return (await this.getBatch(actor, id)).type;
  }

  async approve(actor: Actor, id: string): Promise<BatchView> {
    const before = await this.getBatch(actor, id);
    if (before.status === 'PREVIEWED' && before.validRows < 1) {
      throw opdError(409, OpdErrorCode.IMPORT_NOTHING_TO_SAVE);
    }
    try {
      await this.engine.approve({
        tenantId: actor.tenantId,
        batchId: id,
        actorUserId: actor.userId,
      });
    } catch (error) {
      throw this.stateError(error);
    }
    return this.getBatch(actor, id);
  }

  async cancel(actor: Actor, id: string): Promise<BatchView> {
    await this.typeOfBatch(actor, id);
    try {
      await this.engine.cancel({
        tenantId: actor.tenantId,
        batchId: id,
        actorUserId: actor.userId,
      });
    } catch (error) {
      throw this.stateError(error);
    }
    await this.deleteStoredFile(actor, id);
    return this.getBatch(actor, id);
  }

  private stateError(error: unknown): unknown {
    if (error instanceof HttpException) {
      return error;
    }
    if (/Import batch refused|illegal status|terminal|no-op/i.test(errorText(error))) {
      return opdError(409, OpdErrorCode.IMPORT_STATE);
    }
    return error;
  }

  // ------------------------------------------------------------------------------- posting

  /**
   * Starts saving an APPROVED batch. The claim is one atomic update, so a second click or a second
   * request at the same moment finds the batch already being saved and is refused.
   */
  async post(actor: Actor, id: string): Promise<BatchView> {
    const batch = await this.getBatch(actor, id);
    if (batch.status !== 'APPROVED') {
      throw opdError(409, OpdErrorCode.IMPORT_STATE);
    }
    const staleBefore = new Date(this.clock.now().getTime() - IMPORT_LIMITS.staleRunMs);
    const claimed = await this.tenantDb.withTenant((tx) =>
      tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`UPDATE import_batches
                      SET run_status = 'POSTING', error_message = NULL, updated_at = ${this.clock.now()}
                    WHERE id = ${id} AND tenant_id = ${actor.tenantId} AND status = 'APPROVED'
                      AND (run_status IS NULL OR run_status <> 'POSTING' OR updated_at < ${staleBefore})
                RETURNING id`,
      ),
    );
    if (claimed.length === 0) {
      throw opdError(409, OpdErrorCode.IMPORT_BUSY);
    }
    this.track(this.runPost(actor, id, batch.type));
    return this.getBatch(actor, id);
  }

  /** What the uploader may set as a doctor fee: the hospital-wide fee and any branch, or only own branches. */
  private async feeScopeOf(): Promise<{ wide: boolean; branches: ReadonlySet<string> }> {
    const wide = (await this.access.hospitalWideBranches('opd.prices.write', 'OPD')).length > 0;
    return {
      wide,
      branches: wide
        ? new Set<string>()
        : new Set(await this.access.permittedBranches('opd.prices.write', 'OPD')),
    };
  }

  private async runPost(actor: Actor, id: string, type: ImportTypeCode): Promise<void> {
    try {
      const stored = await this.tenantDb.withTenant((tx) =>
        tx.importBatch.findFirst({
          where: { id, tenantId: actor.tenantId },
          select: { fileStorageKey: true, fileSha256: true },
        }),
      );
      if (!stored) {
        throw new ImportStaleError('FILE_MISSING', null);
      }
      const chunks: Buffer[] = [];
      for await (const chunk of await this.storage.get(actor.tenantId, stored.fileStorageKey)) {
        chunks.push(Buffer.from(chunk as Buffer));
      }
      const buffer = Buffer.concat(chunks);
      // The file that is saved is exactly the file that was approved.
      if (createHash('sha256').update(buffer).digest('hex') !== stored.fileSha256) {
        throw new ImportStaleError('FILE_CHANGED', null);
      }
      const sheet = await readSheet(buffer, type);
      const now = this.clock.now();
      const feeScope = await this.feeScopeOf();
      await this.engine.post(
        {
          tenantId: actor.tenantId,
          batchId: id,
          actorUserId: actor.userId,
          timeoutMs: IMPORT_LIMITS.transactionMs,
        },
        async (tx) => {
          const ctx = await loadContext(tx, actor.tenantId, type, sheet, now, feeScope);
          const prepared = prepareRows(type, sheet, ctx);
          await this.applyRows(tx, actor, id, type, prepared);
          await tx.importBatch.update({
            where: { id },
            data: { runStatus: null, errorMessage: null },
          });
        },
      );
    } catch (error) {
      await this.recordPostFailure(actor, id, error);
    }
  }

  private async recordPostFailure(actor: Actor, id: string, error: unknown): Promise<void> {
    let code = 'RUN_FAILED';
    if (error instanceof ImportStaleError) {
      code = `STALE:${error.reason}${error.rowNumber === null ? '' : `:${error.rowNumber}`}`;
    } else if (error instanceof ImportFileError) {
      code = error.reason;
    } else if (error instanceof HttpException) {
      const body = error.getResponse() as { reason?: string; code?: string };
      code = `STALE:${body.reason ?? body.code ?? 'REFUSED'}`;
    }
    try {
      // The batch stays APPROVED: nothing was saved. It can be cancelled or tried again.
      await this.setRunStatus(id, 'POST_FAILED', code, 'APPROVED');
    } catch {
      // Nothing more can be recorded.
    }
  }

  /** Saves the rows that were valid at the preview, all in the caller's transaction. */
  private async applyRows(
    tx: TenantTx,
    actor: Actor,
    batchId: string,
    type: ImportTypeCode,
    prepared: PreparedRow[],
  ): Promise<void> {
    const stored = await tx.importBatchRow.findMany({
      where: { tenantId: actor.tenantId, batchId },
      select: { id: true, rowNumber: true, rowStatus: true, matchKey: true },
    });
    const byNumber = new Map(stored.map((r) => [r.rowNumber, r]));
    if (stored.length !== prepared.length) {
      throw new ImportStaleError('FILE_CHANGED', null);
    }
    const counts = { created: 0, updated: 0, unchanged: 0, priceVersions: 0 };
    for (const row of prepared) {
      const was = byNumber.get(row.rowNumber);
      if (!was || was.matchKey !== row.matchKey) {
        throw new ImportStaleError('FILE_CHANGED', row.rowNumber);
      }
      if (was.rowStatus !== 'VALID') {
        continue; // an exception at the preview stays skipped
      }
      if (row.issue || !row.data) {
        // Valid at the preview, not valid now: the data changed since. Nothing is saved.
        throw new ImportStaleError(row.issue?.reason ?? 'ROW_CHANGED', row.rowNumber);
      }
      const done = await this.applyRow(tx, actor, row.data);
      await tx.importBatchRow.update({
        where: { id: was.id },
        data: {
          action: done.action,
          resultEntityType: done.entityType,
          resultEntityId: done.entityId,
          previousValues: done.previous as Prisma.InputJsonValue,
        },
      });
      if (done.action === 'CREATE') counts.created += 1;
      else if (done.action === 'UPDATE') counts.updated += 1;
      else counts.unchanged += 1;
      if (done.priceVersion) counts.priceVersions += 1;
    }
    await tx.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        branchId: actor.branchId,
        action: IMPORT_AUDIT.applied,
        entityType: 'import_batches',
        entityId: batchId,
        // Counts only, no names or amounts.
        metadata: { type, ...counts },
      },
    });
  }

  private async applyRow(
    tx: TenantTx,
    actor: Actor,
    data: RowData,
  ): Promise<{
    action: 'CREATE' | 'UPDATE' | 'NONE';
    entityType: string;
    entityId: string;
    previous: Record<string, unknown>;
    priceVersion: boolean;
  }> {
    const tenantId = actor.tenantId;
    if (data.kind === 'MEDICINES') {
      const existing = await tx.medicine.findUnique({
        where: { tenantId_code: { tenantId, code: data.code } },
      });
      if (!existing) {
        const created = await tx.medicine.create({
          data: {
            tenantId,
            code: data.code,
            name: data.name,
            composition: data.composition,
            form: data.form,
            active: data.active,
          },
        });
        return {
          action: 'CREATE',
          entityType: 'medicine',
          entityId: created.id,
          previous: {},
          priceVersion: false,
        };
      }
      const same =
        existing.name === data.name &&
        (existing.composition ?? null) === data.composition &&
        (existing.form ?? null) === data.form &&
        existing.active === data.active;
      if (!same) {
        await tx.medicine.update({
          where: { id: existing.id },
          data: {
            name: data.name,
            composition: data.composition,
            form: data.form,
            active: data.active,
          },
        });
      }
      return {
        action: same ? 'NONE' : 'UPDATE',
        entityType: 'medicine',
        entityId: existing.id,
        previous: {
          name: existing.name,
          composition: existing.composition,
          form: existing.form,
          active: existing.active,
        },
        priceVersion: false,
      };
    }

    if (data.kind === 'DOCTOR_FEES') {
      const result = await this.prices.changeDoctorFeeInTx(
        tx,
        {
          doctorProfileId: data.doctorProfileId,
          visitType: data.visitType,
          amountPaise: data.amountPaise,
          effectiveFrom: data.startDate ?? undefined,
          branchId: data.branchId ?? null,
        },
        actor,
      );
      return {
        action: !result.changed
          ? 'NONE'
          : result.previousAmountPaise === null
            ? 'CREATE'
            : 'UPDATE',
        entityType: 'doctor_fee',
        entityId: result.price.id,
        previous: { amountPaise: result.previousAmountPaise },
        priceVersion: result.changed,
      };
    }

    // TESTS: the item first, then its price.
    let item = await tx.chargeItem.findUnique({
      where: { tenantId_code: { tenantId, code: data.code } },
    });
    let action: 'CREATE' | 'UPDATE' | 'NONE' = 'NONE';
    const previous: Record<string, unknown> = {};
    if (!item) {
      item = await tx.chargeItem.create({
        data: {
          tenantId,
          code: data.code,
          name: data.name,
          kind: 'INVESTIGATION',
          taxable: false,
          taxRateBp: 0,
          active: data.active,
        },
      });
      action = 'CREATE';
    } else {
      if (item.kind !== 'INVESTIGATION') {
        throw new ImportStaleError('CODE_USED_BY_OTHER_ITEM', null);
      }
      previous.name = item.name;
      previous.active = item.active;
      if (item.name !== data.name || item.active !== data.active) {
        item = await tx.chargeItem.update({
          where: { id: item.id },
          data: { name: data.name, active: data.active },
        });
        action = 'UPDATE';
      }
    }
    let priceVersion = false;
    if (data.active && data.amountPaise !== null) {
      const result = await this.prices.changeChargeItemPriceInTx(
        tx,
        item.id,
        { amountPaise: data.amountPaise, effectiveFrom: data.startDate ?? undefined },
        actor,
      );
      previous.amountPaise = result.previousAmountPaise;
      priceVersion = result.changed;
      if (result.changed && action === 'NONE') {
        action = 'UPDATE';
      }
    }
    return { action, entityType: 'charge_item', entityId: item.id, previous, priceVersion };
  }
}
