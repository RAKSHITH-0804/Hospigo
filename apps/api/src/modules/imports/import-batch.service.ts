import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { TenantDb, type TenantTx } from '../../database/tenant-db';
import type { ImportBatchStatus, ImportExceptionStatus, Prisma } from '../../generated/prisma';

@Injectable()
export class ImportBatchService {
  constructor(
    private readonly tenantDb: TenantDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Create a DRAFT batch. Refuses while the same file is active
   * (DRAFT|PREVIEWED|APPROVED|POSTED) for this tenant/type/branch.
   */
  async createBatch(input: {
    tenantId: string;
    importTypeId: string;
    createdBy: string;
    templateVersion: string;
    fileStorageKey: string;
    fileSha256: string;
    fileNameOriginal: string;
    branchId?: string | null;
    periodStart?: Date | null;
    periodEnd?: Date | null;
  }): Promise<{ id: string }> {
    return this.tenantDb.withTenant(async (tx) => {
      try {
        const created = await tx.importBatch.create({
          data: {
            tenantId: input.tenantId,
            importTypeId: input.importTypeId,
            branchId: input.branchId ?? null,
            status: 'DRAFT',
            templateVersion: input.templateVersion,
            periodStart: input.periodStart ?? null,
            periodEnd: input.periodEnd ?? null,
            fileStorageKey: input.fileStorageKey,
            fileSha256: input.fileSha256,
            fileNameOriginal: input.fileNameOriginal,
            createdBy: input.createdBy,
          },
        });
        await this.audit(tx, {
          tenantId: input.tenantId,
          actorUserId: input.createdBy,
          batchId: created.id,
          from: null,
          to: 'DRAFT',
          reason: 'createBatch',
        });
        return { id: created.id };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/import_batches_active_file_uidx|unique/i.test(message)) {
          throw new Error(
            'Import batch refused: an active batch already exists for this file (same tenant, type, branch, sha256)',
          );
        }
        throw error;
      }
    });
  }

  async markPreviewed(input: {
    tenantId: string;
    batchId: string;
    actorUserId: string;
    totalRows?: number;
    validRows?: number;
    exceptionRows?: number;
  }): Promise<void> {
    await this.transition(input.tenantId, input.batchId, input.actorUserId, 'PREVIEWED', {
      expectedFrom: ['DRAFT'],
      extra: {
        totalRows: input.totalRows,
        validRows: input.validRows,
        exceptionRows: input.exceptionRows,
      },
    });
  }

  async approve(input: { tenantId: string; batchId: string; actorUserId: string }): Promise<void> {
    const now = this.clock.now();
    await this.transition(input.tenantId, input.batchId, input.actorUserId, 'APPROVED', {
      expectedFrom: ['PREVIEWED'],
      extra: {
        approvedBy: input.actorUserId,
        approvedAt: now,
      },
    });
  }

  async post(input: { tenantId: string; batchId: string; actorUserId: string }): Promise<void> {
    const now = this.clock.now();
    await this.tenantDb.withTenant(async (tx) => {
      const batch = await this.lockBatch(tx, input.tenantId, input.batchId);
      if (batch.status !== 'APPROVED') {
        throw new Error(`Import batch refused: expected status APPROVED, found ${batch.status}`);
      }
      const from = batch.status;
      const updated = await tx.importBatch.update({
        where: { id: input.batchId },
        data: {
          status: 'POSTED',
          postedAt: now,
          postedRows: batch.validRows,
        },
      });
      await tx.importBatchRow.updateMany({
        where: {
          tenantId: input.tenantId,
          batchId: input.batchId,
          rowStatus: 'VALID',
        },
        data: { rowStatus: 'POSTED' },
      });
      await this.audit(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        batchId: updated.id,
        from,
        to: 'POSTED',
        reason: 'post',
      });
    });
  }

  /**
   * Undo a POSTED batch: batch -> UNDONE, POSTED rows -> REVERSED.
   * Domain reverse handlers belong to later feature steps; this only updates bookkeeping.
   */
  async undo(input: {
    tenantId: string;
    batchId: string;
    actorUserId: string;
    reason: string;
  }): Promise<void> {
    if (!input.reason.trim()) {
      throw new Error('undo requires a non-empty reason');
    }
    const now = this.clock.now();
    await this.tenantDb.withTenant(async (tx) => {
      const batch = await this.lockBatch(tx, input.tenantId, input.batchId);
      if (batch.status !== 'POSTED') {
        throw new Error(`Import batch refused: expected status POSTED, found ${batch.status}`);
      }
      const from = batch.status;
      await tx.importBatch.update({
        where: { id: input.batchId },
        data: {
          status: 'UNDONE',
          undoneBy: input.actorUserId,
          undoneAt: now,
          undoReason: input.reason.trim(),
        },
      });
      await tx.importBatchRow.updateMany({
        where: {
          tenantId: input.tenantId,
          batchId: input.batchId,
          rowStatus: 'POSTED',
        },
        data: { rowStatus: 'REVERSED' },
      });
      await this.audit(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        batchId: input.batchId,
        from,
        to: 'UNDONE',
        reason: input.reason.trim(),
      });
    });
  }

  async fail(input: {
    tenantId: string;
    batchId: string;
    actorUserId: string;
    errorMessage: string;
  }): Promise<void> {
    // DRAFT|PREVIEWED only: concurrent approve vs fail must be mutually exclusive.
    // APPROVED→FAILED remains legal at the DATABASE trigger; cancel-after-approve is a
    // separate intentional path (raw/admin or a future cancelApproved), not this race.
    await this.transition(input.tenantId, input.batchId, input.actorUserId, 'FAILED', {
      expectedFrom: ['DRAFT', 'PREVIEWED'],
      extra: {
        runStatus: 'FAILED',
        errorMessage: input.errorMessage,
      },
    });
  }

  /**
   * Record an exception for an unmatched / invalid row.
   * Does not create any domain/master record — bookkeeping only.
   */
  async recordException(input: {
    tenantId: string;
    batchId: string;
    rowId: string;
    reasonCode: string;
    message: string;
    actorUserId: string;
  }): Promise<{ id: string }> {
    return this.tenantDb.withTenant(async (tx) => {
      await tx.importBatchRow.update({
        where: { id: input.rowId },
        data: { rowStatus: 'EXCEPTION' },
      });
      const ex = await tx.importException.create({
        data: {
          tenantId: input.tenantId,
          batchId: input.batchId,
          rowId: input.rowId,
          reasonCode: input.reasonCode,
          message: input.message,
          status: 'OPEN',
        },
      });
      await tx.importBatch.update({
        where: { id: input.batchId },
        data: { exceptionRows: { increment: 1 } },
      });
      await this.audit(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        batchId: input.batchId,
        from: null,
        to: 'EXCEPTION',
        reason: `recordException:${input.reasonCode}`,
        entityId: ex.id,
      });
      return { id: ex.id };
    });
  }

  async resolveException(input: {
    tenantId: string;
    exceptionId: string;
    actorUserId: string;
    note: string;
    status?: Extract<ImportExceptionStatus, 'RESOLVED' | 'DISMISSED'>;
  }): Promise<void> {
    if (!input.note.trim()) {
      throw new Error('resolveException requires a non-empty note');
    }
    const now = this.clock.now();
    const status = input.status ?? 'RESOLVED';
    await this.tenantDb.withTenant(async (tx) => {
      const ex = await tx.importException.findFirst({
        where: { id: input.exceptionId, tenantId: input.tenantId },
      });
      if (!ex) {
        throw new Error('Import exception not found');
      }
      await tx.importException.update({
        where: { id: input.exceptionId },
        data: {
          status,
          resolvedBy: input.actorUserId,
          resolvedAt: now,
          resolutionNote: input.note.trim(),
        },
      });
      await this.audit(tx, {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        batchId: ex.batchId,
        from: ex.status,
        to: status,
        reason: input.note.trim(),
        entityId: ex.id,
        entityType: 'import_exceptions',
      });
    });
  }

  private async transition(
    tenantId: string,
    batchId: string,
    actorUserId: string,
    to: ImportBatchStatus,
    options: {
      expectedFrom: ImportBatchStatus[];
      extra?: Prisma.ImportBatchUncheckedUpdateInput;
    },
  ): Promise<void> {
    await this.tenantDb.withTenant(async (tx) => {
      const batch = await this.lockBatch(tx, tenantId, batchId);
      if (!options.expectedFrom.includes(batch.status)) {
        throw new Error(
          `Import batch refused: expected status ${options.expectedFrom.join('|')}, found ${batch.status}`,
        );
      }
      const from = batch.status;
      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: to, ...(options.extra ?? {}) },
      });
      await this.audit(tx, {
        tenantId,
        actorUserId,
        batchId,
        from,
        to,
        reason: `transition:${String(from)}->${to}`,
      });
    });
  }

  /** Lock the batch row for the duration of the transition (concurrency-safe). */
  private async lockBatch(tx: TenantTx, tenantId: string, batchId: string) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: ImportBatchStatus;
        valid_rows: number;
      }>
    >`
      SELECT id, status, valid_rows
      FROM import_batches
      WHERE id = ${batchId} AND tenant_id = ${tenantId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) {
      throw new Error('Import batch not found');
    }
    return {
      id: row.id,
      status: row.status,
      validRows: row.valid_rows,
    };
  }

  private async audit(
    tx: TenantTx,
    input: {
      tenantId: string;
      actorUserId: string;
      batchId: string;
      from: string | null;
      to: string;
      reason: string;
      entityId?: string;
      entityType?: string;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: 'IMPORT_BATCH_TRANSITION',
        entityType: input.entityType ?? 'import_batches',
        entityId: input.entityId ?? input.batchId,
        reason: input.reason,
        metadata: {
          batchId: input.batchId,
          from: input.from,
          to: input.to,
        },
      },
    });
  }
}
