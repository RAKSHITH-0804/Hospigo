import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock';
import { PrismaService } from '../../database/prisma.service';
import type { ImportBatchStatus, ImportExceptionStatus, Prisma } from '../../generated/prisma';

type Tx = Prisma.TransactionClient;

@Injectable()
export class ImportBatchService {
  constructor(
    private readonly prisma: PrismaService,
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
    return this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, input.tenantId);
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
      totalRows: input.totalRows,
      validRows: input.validRows,
      exceptionRows: input.exceptionRows,
    });
  }

  async approve(input: { tenantId: string; batchId: string; actorUserId: string }): Promise<void> {
    const now = this.clock.now();
    await this.transition(input.tenantId, input.batchId, input.actorUserId, 'APPROVED', {
      approvedBy: input.actorUserId,
      approvedAt: now,
    });
  }

  async post(input: { tenantId: string; batchId: string; actorUserId: string }): Promise<void> {
    const now = this.clock.now();
    await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, input.tenantId);
      const batch = await this.requireBatch(tx, input.tenantId, input.batchId);
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
    await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, input.tenantId);
      const batch = await this.requireBatch(tx, input.tenantId, input.batchId);
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
    await this.transition(input.tenantId, input.batchId, input.actorUserId, 'FAILED', {
      runStatus: 'FAILED',
      errorMessage: input.errorMessage,
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
    return this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, input.tenantId);
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
    await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, input.tenantId);
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
    extra: Prisma.ImportBatchUncheckedUpdateInput = {},
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.setTenant(tx, tenantId);
      const batch = await this.requireBatch(tx, tenantId, batchId);
      const from = batch.status;
      await tx.importBatch.update({
        where: { id: batchId },
        data: { status: to, ...extra },
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

  private async requireBatch(tx: Tx, tenantId: string, batchId: string) {
    const batch = await tx.importBatch.findFirst({ where: { id: batchId, tenantId } });
    if (!batch) {
      throw new Error('Import batch not found');
    }
    return batch;
  }

  private async setTenant(tx: Tx, tenantId: string): Promise<void> {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
  }

  private async audit(
    tx: Tx,
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
