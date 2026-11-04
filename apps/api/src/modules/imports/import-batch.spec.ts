import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { FakeClock } from '../../common/clock';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import {
  autoHospitalContext,
  createAppPrisma,
  createOwnerPrisma,
  createPgClient,
  createTenantDb,
  GLOBAL_TABLES,
  requireTestDatabaseUrl,
} from '../../database/db-test.util';
import { PrismaClient } from '../../generated/prisma';
import { ImportBatchService } from './import-batch.service';

const ALL_STATUSES = ['DRAFT', 'PREVIEWED', 'APPROVED', 'POSTED', 'UNDONE', 'FAILED'] as const;
type BatchStatus = (typeof ALL_STATUSES)[number];

const ALLOWED_TRANSITIONS = new Set<string>([
  'DRAFT->PREVIEWED',
  'DRAFT->FAILED',
  'PREVIEWED->APPROVED',
  'PREVIEWED->FAILED',
  'APPROVED->POSTED',
  'APPROVED->FAILED',
  'POSTED->UNDONE',
]);

function createDedicatedAppPrisma(): { prisma: PrismaClient; pool: Pool } {
  const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 1 });
  return { prisma: new PrismaClient({ adapter: new PrismaPg(pool) }), pool };
}

function createStartBarrier(total: number): () => Promise<void> {
  let arrived = 0;
  const waiters: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
      arrived += 1;
      if (arrived >= total) {
        for (const w of waiters) w();
      }
    });
}

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('Import batches (hospigo_test only)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(60_000);

  const owner = createOwnerPrisma();
  const app = createAppPrisma();
  const clock = new FakeClock(new Date('2026-06-15T12:00:00.000Z'));
  let tenantId: string;
  let tenantOther: string;
  let branchMain: string;
  let branchEast: string;
  let actorId: string;
  let actorOther: string;
  let importTypeId: string;
  let importTypeOther: string;
  let service: ImportBatchService;

  beforeAll(async () => {
    const stamp = Date.now();
    const hospital = await owner.hospital.create({
      data: {
        code: `IMP_${stamp}`,
        name: 'Import Test Hospital',
        accessCode: `imp-${stamp}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true },
            { code: 'EAST', name: 'East', isMain: false },
          ],
        },
      },
      include: { branches: true },
    });
    tenantId = hospital.id;
    branchMain = hospital.branches.find((b) => b.code === 'MAIN')!.id;
    branchEast = hospital.branches.find((b) => b.code === 'EAST')!.id;

    const other = await owner.hospital.create({
      data: {
        code: `IMP_O_${stamp}`,
        name: 'Import Other Hospital',
        accessCode: `impo-${stamp}`,
        isTest: true,
        branches: { create: { code: 'MAIN', name: 'Main', isMain: true } },
      },
      include: { branches: true },
    });
    tenantOther = other.id;

    const actor = await owner.user.create({
      data: {
        tenantId,
        code: `IMPA_${stamp}`,
        email: `impa_${stamp}@example.test`,
        displayName: 'Importer',
        passwordHash: 'x',
      },
    });
    actorId = actor.id;
    const actorO = await owner.user.create({
      data: {
        tenantId: tenantOther,
        code: `IMPO_${stamp}`,
        email: `impo_${stamp}@example.test`,
        displayName: 'Other',
        passwordHash: 'x',
      },
    });
    actorOther = actorO.id;

    const t1 = await owner.importType.create({
      data: { code: `PATIENTS_${stamp}`, name: 'Patients fixture type' },
    });
    importTypeId = t1.id;
    const t2 = await owner.importType.create({
      data: { code: `OTHER_${stamp}`, name: 'Other fixture type' },
    });
    importTypeOther = t2.id;

    service = autoHospitalContext(new ImportBatchService(createTenantDb(app), clock));
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  describe('database state machine (raw SQL as hospigo_app)', () => {
    async function insertDraft(
      client: ReturnType<typeof createPgClient>,
      sha: string,
    ): Promise<string> {
      const id = `batch_${sha}`;
      await client.query(
        `INSERT INTO import_batches
          (id, tenant_id, import_type_id, branch_id, status, template_version,
           file_storage_key, file_sha256, file_name_original, created_by)
         VALUES ($1,$2,$3,$4,'DRAFT','1',$5,$6,'f.xlsx',$7)`,
        [
          id,
          tenantId,
          importTypeId,
          branchMain,
          `tenants/${tenantId}/imports/${sha}`,
          sha,
          actorId,
        ],
      );
      return id;
    }

    async function applyStatus(
      client: ReturnType<typeof createPgClient>,
      id: string,
      to: BatchStatus,
    ): Promise<void> {
      if (to === 'APPROVED') {
        await client.query(
          `UPDATE import_batches
           SET status = 'APPROVED', approved_by = $2, approved_at = NOW()
           WHERE id = $1`,
          [id, actorId],
        );
        return;
      }
      if (to === 'POSTED') {
        await client.query(
          `UPDATE import_batches SET status = 'POSTED', posted_at = NOW() WHERE id = $1`,
          [id],
        );
        return;
      }
      if (to === 'UNDONE') {
        await client.query(
          `UPDATE import_batches
           SET status = 'UNDONE', undone_by = $2, undone_at = NOW(), undo_reason = 'undo'
           WHERE id = $1`,
          [id, actorId],
        );
        return;
      }
      await client.query(`UPDATE import_batches SET status = $2 WHERE id = $1`, [id, to]);
    }

    /** Walk a fresh DRAFT to the requested status along a legal path. */
    async function placeInStatus(
      client: ReturnType<typeof createPgClient>,
      target: BatchStatus,
    ): Promise<string> {
      const id = await insertDraft(client, `mx_${target}_${Date.now()}_${Math.random()}`);
      const path: BatchStatus[] =
        target === 'DRAFT'
          ? []
          : target === 'PREVIEWED'
            ? ['PREVIEWED']
            : target === 'APPROVED'
              ? ['PREVIEWED', 'APPROVED']
              : target === 'POSTED'
                ? ['PREVIEWED', 'APPROVED', 'POSTED']
                : target === 'UNDONE'
                  ? ['PREVIEWED', 'APPROVED', 'POSTED', 'UNDONE']
                  : ['FAILED'];
      for (const step of path) {
        await applyStatus(client, id, step);
      }
      return id;
    }

    it('full 6x6 status matrix: only allowed transitions succeed; all others refuse', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        for (const from of ALL_STATUSES) {
          for (const to of ALL_STATUSES) {
            await client.query('BEGIN');
            await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
            const id = await placeInStatus(client, from);
            const key = `${from}->${to}`;
            const allowed = ALLOWED_TRANSITIONS.has(key);
            if (allowed) {
              await expect(applyStatus(client, id, to)).resolves.toBeUndefined();
            } else {
              await expect(applyStatus(client, id, to)).rejects.toThrow(
                /illegal status transition|terminal|no-op refused|APPROVED requires|earlier approval|UNDONE requires/i,
              );
            }
            await client.query('ROLLBACK');
          }
        }
      } finally {
        await client.end();
      }
    });

    it('APPROVED/POSTED/UNDONE field requirements enforced at DATABASE level', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        const id = await placeInStatus(client, 'PREVIEWED');
        await expect(
          client.query(`UPDATE import_batches SET status = 'APPROVED' WHERE id = $1`, [id]),
        ).rejects.toThrow(/APPROVED requires/i);
        await client.query('ROLLBACK');

        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        const id2 = await placeInStatus(client, 'APPROVED');
        await client.query(
          `UPDATE import_batches SET approved_by = NULL, approved_at = NULL WHERE id = $1`,
          [id2],
        );
        await expect(
          client.query(`UPDATE import_batches SET status = 'POSTED' WHERE id = $1`, [id2]),
        ).rejects.toThrow(/earlier approval/i);
        await client.query('ROLLBACK');

        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        const id3 = await placeInStatus(client, 'POSTED');
        await expect(
          client.query(`UPDATE import_batches SET status = 'UNDONE' WHERE id = $1`, [id3]),
        ).rejects.toThrow(/UNDONE requires/i);
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });
  });

  describe('idempotency', () => {
    it('refuses the same active file; allows after UNDONE/FAILED; allows other branch/hospital', async () => {
      const sha = `idem_${Date.now()}`;
      const first = await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/${sha}`,
        fileSha256: sha,
        fileNameOriginal: 'a.xlsx',
        branchId: branchMain,
      });
      await expect(
        service.createBatch({
          tenantId,
          importTypeId,
          createdBy: actorId,
          templateVersion: '1',
          fileStorageKey: `k/${sha}-2`,
          fileSha256: sha,
          fileNameOriginal: 'a.xlsx',
          branchId: branchMain,
        }),
      ).rejects.toThrow(/active batch already exists/i);

      // Other branch OK
      await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/${sha}-east`,
        fileSha256: sha,
        fileNameOriginal: 'a.xlsx',
        branchId: branchEast,
      });

      // Other hospital OK
      await service.createBatch({
        tenantId: tenantOther,
        importTypeId: importTypeOther,
        createdBy: actorOther,
        templateVersion: '1',
        fileStorageKey: `k/${sha}-other`,
        fileSha256: sha,
        fileNameOriginal: 'a.xlsx',
      });

      await service.fail({
        tenantId,
        batchId: first.id,
        actorUserId: actorId,
        errorMessage: 'boom',
      });
      // After FAILED, same file OK again
      await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/${sha}-retry`,
        fileSha256: sha,
        fileNameOriginal: 'a.xlsx',
        branchId: branchMain,
      });
    });
  });

  describe('raw_values / row_number immutability', () => {
    it('refuses raw SQL UPDATE of raw_values or row_number', async () => {
      const batch = await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/raw_${Date.now()}`,
        fileSha256: `raw_${Date.now()}`,
        fileNameOriginal: 'r.xlsx',
        branchId: branchMain,
      });
      const row = await owner.importBatchRow.create({
        data: {
          tenantId,
          batchId: batch.id,
          rowNumber: 1,
          matchKey: 'MK1',
          rawValues: { a: 1 },
        },
      });

      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        await expect(
          client.query(`UPDATE import_batch_rows SET row_number = 2 WHERE id = $1`, [row.id]),
        ).rejects.toThrow(/row_number is immutable/i);
        await client.query('ROLLBACK');

        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        await expect(
          client.query(`UPDATE import_batch_rows SET raw_values = '{"b":2}'::jsonb WHERE id = $1`, [
            row.id,
          ]),
        ).rejects.toThrow(/raw_values is immutable/i);
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });
  });

  describe('exceptions and unmatched rows', () => {
    it('OPEN to RESOLVED needs resolver and note; unmatched creates exception and no patient', async () => {
      const batch = await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/ex_${Date.now()}`,
        fileSha256: `ex_${Date.now()}`,
        fileNameOriginal: 'e.xlsx',
        branchId: branchMain,
      });
      const row = await owner.importBatchRow.create({
        data: {
          tenantId,
          batchId: batch.id,
          rowNumber: 1,
          matchKey: 'UNMATCHED_CODE',
          rawValues: { code: 'UNMATCHED_CODE' },
        },
      });

      const patientsBefore = await owner.patient.count({ where: { tenantId } });
      const { id: exId } = await service.recordException({
        tenantId,
        batchId: batch.id,
        rowId: row.id,
        reasonCode: 'UNMATCHED',
        message: 'no master match',
        actorUserId: actorId,
      });
      const patientsAfter = await owner.patient.count({ where: { tenantId } });
      expect(patientsAfter).toBe(patientsBefore);

      const rowAfter = await owner.importBatchRow.findUniqueOrThrow({ where: { id: row.id } });
      expect(rowAfter.rowStatus).toBe('EXCEPTION');

      await expect(
        service.resolveException({
          tenantId,
          exceptionId: exId,
          actorUserId: actorId,
          note: '   ',
        }),
      ).rejects.toThrow(/non-empty note/i);

      await service.resolveException({
        tenantId,
        exceptionId: exId,
        actorUserId: actorId,
        note: 'dismissed after review',
        status: 'DISMISSED',
      });
      const ex = await owner.importException.findUniqueOrThrow({ where: { id: exId } });
      expect(ex.status).toBe('DISMISSED');
      expect(ex.resolvedBy).toBe(actorId);
      expect(ex.resolutionNote).toBe('dismissed after review');
    });
  });

  describe('service transitions, undo, audit', () => {
    it('posts then undoes with REVERSED rows and audit for every transition', async () => {
      const batch = await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/flow_${Date.now()}`,
        fileSha256: `flow_${Date.now()}`,
        fileNameOriginal: 'flow.xlsx',
        branchId: branchMain,
      });
      await owner.importBatchRow.create({
        data: {
          tenantId,
          batchId: batch.id,
          rowNumber: 1,
          matchKey: 'P1',
          rawValues: { code: 'P1' },
          rowStatus: 'VALID',
        },
      });

      await service.markPreviewed({
        tenantId,
        batchId: batch.id,
        actorUserId: actorId,
        totalRows: 1,
        validRows: 1,
        exceptionRows: 0,
      });
      await service.approve({ tenantId, batchId: batch.id, actorUserId: actorId });
      await service.post({ tenantId, batchId: batch.id, actorUserId: actorId });

      const posted = await owner.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(posted.status).toBe('POSTED');
      const postedRows = await owner.importBatchRow.findMany({
        where: { batchId: batch.id, rowStatus: 'POSTED' },
      });
      expect(postedRows).toHaveLength(1);

      await service.undo({
        tenantId,
        batchId: batch.id,
        actorUserId: actorId,
        reason: 'rollback import',
      });
      const undone = await owner.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(undone.status).toBe('UNDONE');
      expect(undone.undoReason).toBe('rollback import');
      const reversed = await owner.importBatchRow.findMany({
        where: { batchId: batch.id, rowStatus: 'REVERSED' },
      });
      expect(reversed).toHaveLength(1);

      const audits = await owner.auditLog.findMany({
        where: {
          tenantId,
          entityType: 'import_batches',
          entityId: batch.id,
          action: 'IMPORT_BATCH_TRANSITION',
        },
        orderBy: { createdAt: 'asc' },
      });
      const tos = audits.map((a) => (a.metadata as { to?: string } | null)?.to);
      expect(tos).toEqual(
        expect.arrayContaining(['DRAFT', 'PREVIEWED', 'APPROVED', 'POSTED', 'UNDONE']),
      );

      // Same file allowed again after UNDONE
      await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/flow_retry_${Date.now()}`,
        fileSha256: posted.fileSha256,
        fileNameOriginal: 'flow.xlsx',
        branchId: branchMain,
      });
    });
  });

  describe('duplicate detection with NULL branch_id', () => {
    it('two active NULL-branch batches same hash refuse; NULL vs real branch allowed; different hash allowed', async () => {
      const hash = `null_br_${Date.now()}`;
      await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/${hash}_a`,
        fileSha256: hash,
        fileNameOriginal: 'a.xlsx',
        branchId: null,
      });
      await expect(
        service.createBatch({
          tenantId,
          importTypeId,
          createdBy: actorId,
          templateVersion: '1',
          fileStorageKey: `k/${hash}_b`,
          fileSha256: hash,
          fileNameOriginal: 'b.xlsx',
          branchId: null,
        }),
      ).rejects.toThrow(/active batch already exists/i);

      const withBranch = await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/${hash}_branch`,
        fileSha256: hash,
        fileNameOriginal: 'c.xlsx',
        branchId: branchMain,
      });
      const withBranchRow = await owner.importBatch.findUniqueOrThrow({
        where: { id: withBranch.id },
      });
      expect(withBranchRow).toMatchObject({ status: 'DRAFT', branchId: branchMain });

      const otherHash = await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/${hash}_diff`,
        fileSha256: `${hash}_other`,
        fileNameOriginal: 'd.xlsx',
        branchId: null,
      });
      const otherHashRow = await owner.importBatch.findUniqueOrThrow({
        where: { id: otherHash.id },
      });
      expect(otherHashRow).toMatchObject({ status: 'DRAFT', branchId: null });
    });
  });

  describe('exception resolution CHECK (raw SQL)', () => {
    async function insertOpenException(
      client: ReturnType<typeof createPgClient>,
      suffix: string,
    ): Promise<string> {
      const batchId = `exc_batch_${suffix}`;
      const rowId = `exc_row_${suffix}`;
      const excId = `exc_${suffix}`;
      await client.query(
        `INSERT INTO import_batches
          (id, tenant_id, import_type_id, branch_id, status, template_version,
           file_storage_key, file_sha256, file_name_original, created_by)
         VALUES ($1,$2,$3,$4,'DRAFT','1',$5,$6,'e.xlsx',$7)`,
        [
          batchId,
          tenantId,
          importTypeId,
          branchMain,
          `tenants/${tenantId}/imports/${suffix}`,
          suffix,
          actorId,
        ],
      );
      await client.query(
        `INSERT INTO import_batch_rows
          (id, tenant_id, batch_id, row_number, match_key, raw_values)
         VALUES ($1,$2,$3,1,'MK',$4::jsonb)`,
        [rowId, tenantId, batchId, JSON.stringify({ x: 1 })],
      );
      await client.query(
        `INSERT INTO import_exceptions
          (id, tenant_id, batch_id, row_id, reason_code, message, status)
         VALUES ($1,$2,$3,$4,'UNMATCHED_ROW','unmatched','OPEN')`,
        [excId, tenantId, batchId, rowId],
      );
      return excId;
    }

    it('refuses RESOLVED/DISMISSED without resolved_by, resolved_at, or note (incl empty string)', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        const attempts: Array<{ label: string; sql: string; params: unknown[] }> = [
          {
            label: 'RESOLVED missing resolved_by',
            sql: `UPDATE import_exceptions
                  SET status = 'RESOLVED', resolved_by = NULL, resolved_at = NOW(), resolution_note = 'ok'
                  WHERE id = $1`,
            params: [],
          },
          {
            label: 'RESOLVED missing resolved_at',
            sql: `UPDATE import_exceptions
                  SET status = 'RESOLVED', resolved_by = $2, resolved_at = NULL, resolution_note = 'ok'
                  WHERE id = $1`,
            params: [actorId],
          },
          {
            label: 'RESOLVED missing note',
            sql: `UPDATE import_exceptions
                  SET status = 'RESOLVED', resolved_by = $2, resolved_at = NOW(), resolution_note = NULL
                  WHERE id = $1`,
            params: [actorId],
          },
          {
            label: 'RESOLVED empty-string note',
            sql: `UPDATE import_exceptions
                  SET status = 'RESOLVED', resolved_by = $2, resolved_at = NOW(), resolution_note = ''
                  WHERE id = $1`,
            params: [actorId],
          },
          {
            label: 'DISMISSED missing resolved_by',
            sql: `UPDATE import_exceptions
                  SET status = 'DISMISSED', resolved_by = NULL, resolved_at = NOW(), resolution_note = 'ok'
                  WHERE id = $1`,
            params: [],
          },
          {
            label: 'DISMISSED missing resolved_at',
            sql: `UPDATE import_exceptions
                  SET status = 'DISMISSED', resolved_by = $2, resolved_at = NULL, resolution_note = 'ok'
                  WHERE id = $1`,
            params: [actorId],
          },
          {
            label: 'DISMISSED missing note',
            sql: `UPDATE import_exceptions
                  SET status = 'DISMISSED', resolved_by = $2, resolved_at = NOW(), resolution_note = NULL
                  WHERE id = $1`,
            params: [actorId],
          },
          {
            label: 'DISMISSED empty-string note',
            sql: `UPDATE import_exceptions
                  SET status = 'DISMISSED', resolved_by = $2, resolved_at = NOW(), resolution_note = '   '
                  WHERE id = $1`,
            params: [actorId],
          },
        ];

        for (const [i, attempt] of attempts.entries()) {
          await client.query('BEGIN');
          await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
          const id = await insertOpenException(client, `chk_${Date.now()}_${i}`);
          const params = [id, ...attempt.params];
          await expect(client.query(attempt.sql, params)).rejects.toThrow(
            /import_exceptions_resolved_fields_chk|check constraint/i,
          );
          await client.query('ROLLBACK');
        }
      } finally {
        await client.end();
      }
    });
  });

  describe('unmatched row isolation from domain tables', () => {
    it('unmatched row creates exception only; all non-import tenant table counts unchanged', async () => {
      const exclude = [
        ...GLOBAL_TABLES,
        'import_batches',
        'import_batch_rows',
        'import_exceptions',
        'audit_logs',
      ];
      const catalog = await owner.$queryRawUnsafe<{ relname: string }[]>(
        `
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname <> ALL($1::text[])
          AND EXISTS (
            SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
          )
        ORDER BY 1
        `,
        exclude,
      );
      expect(catalog.length).toBeGreaterThan(0);

      const before = new Map<string, number>();
      for (const { relname } of catalog) {
        const rows = await owner.$queryRawUnsafe<{ c: bigint }[]>(
          `SELECT COUNT(*)::bigint AS c FROM "${relname}" WHERE tenant_id = $1`,
          tenantId,
        );
        before.set(relname, Number(rows[0]?.c ?? 0));
      }

      const batch = await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/unmatched_snap_${Date.now()}`,
        fileSha256: `unmatched_snap_${Date.now()}`,
        fileNameOriginal: 'u.xlsx',
        branchId: branchMain,
      });
      const row = await owner.importBatchRow.create({
        data: {
          tenantId,
          batchId: batch.id,
          rowNumber: 1,
          matchKey: 'GHOST',
          rawValues: { firstName: 'Ghost' },
        },
      });
      await service.recordException({
        tenantId,
        batchId: batch.id,
        rowId: row.id,
        reasonCode: 'UNMATCHED_ROW',
        message: 'no master match',
        actorUserId: actorId,
      });

      const exceptions = await owner.importException.findMany({
        where: { tenantId, batchId: batch.id },
      });
      expect(exceptions).toHaveLength(1);
      expect(exceptions[0]?.reasonCode).toBe('UNMATCHED_ROW');
      expect(exceptions[0]?.status).toBe('OPEN');

      for (const { relname } of catalog) {
        const rows = await owner.$queryRawUnsafe<{ c: bigint }[]>(
          `SELECT COUNT(*)::bigint AS c FROM "${relname}" WHERE tenant_id = $1`,
          tenantId,
        );
        expect({ table: relname, count: Number(rows[0]?.c ?? 0) }).toEqual({
          table: relname,
          count: before.get(relname),
        });
      }
    });
  });

  describe('concurrency (separate connections + start barrier)', () => {
    jest.setTimeout(120_000);

    async function seedPreviewed(prefix: string): Promise<string> {
      const batch = await service.createBatch({
        tenantId,
        importTypeId,
        createdBy: actorId,
        templateVersion: '1',
        fileStorageKey: `k/${prefix}_${Date.now()}`,
        fileSha256: `${prefix}_${Date.now()}`,
        fileNameOriginal: 'c.xlsx',
        branchId: branchMain,
      });
      await owner.importBatchRow.create({
        data: {
          tenantId,
          batchId: batch.id,
          rowNumber: 1,
          matchKey: 'P1',
          rawValues: { code: 'P1' },
          rowStatus: 'VALID',
        },
      });
      await service.markPreviewed({
        tenantId,
        batchId: batch.id,
        actorUserId: actorId,
        totalRows: 1,
        validRows: 1,
        exceptionRows: 0,
      });
      return batch.id;
    }

    function countTransitionAudits(audits: Array<{ metadata: unknown }>, to: string): number {
      return audits.filter((a) => (a.metadata as { to?: string } | null)?.to === to).length;
    }

    it('20 simultaneous approve calls: exactly one succeeds, rest refuse, one audit row', async () => {
      const batchId = await seedPreviewed('conc_appr');
      const N = 20;
      const barrier = createStartBarrier(N);
      const clients = Array.from({ length: N }, () => createDedicatedAppPrisma());
      const servicesN = clients.map((c) =>
        autoHospitalContext(new ImportBatchService(createTenantDb(c.prisma), clock)),
      );

      const results = await Promise.allSettled(
        servicesN.map(async (svc) => {
          await barrier();
          return svc.approve({ tenantId, batchId, actorUserId: actorId });
        }),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(N - 1);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(String(r.reason)).toMatch(/expected status PREVIEWED|Import batch refused/i);
        }
      }

      const audits = await owner.auditLog.findMany({
        where: {
          tenantId,
          entityType: 'import_batches',
          entityId: batchId,
          action: 'IMPORT_BATCH_TRANSITION',
        },
      });
      expect(countTransitionAudits(audits, 'APPROVED')).toBe(1);

      await Promise.all(
        clients.map(async (c) => {
          await c.prisma.$disconnect();
          await c.pool.end();
        }),
      );
    });

    it('20 simultaneous post calls: exactly one succeeds, rest refuse, one audit row', async () => {
      const batchId = await seedPreviewed('conc_post');
      await service.approve({ tenantId, batchId, actorUserId: actorId });

      const N = 20;
      const barrier = createStartBarrier(N);
      const clients = Array.from({ length: N }, () => createDedicatedAppPrisma());
      const servicesN = clients.map((c) =>
        autoHospitalContext(new ImportBatchService(createTenantDb(c.prisma), clock)),
      );

      const results = await Promise.allSettled(
        servicesN.map(async (svc) => {
          await barrier();
          return svc.post({ tenantId, batchId, actorUserId: actorId });
        }),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(N - 1);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(String(r.reason)).toMatch(/expected status APPROVED|Import batch refused/i);
        }
      }

      const audits = await owner.auditLog.findMany({
        where: {
          tenantId,
          entityType: 'import_batches',
          entityId: batchId,
          action: 'IMPORT_BATCH_TRANSITION',
        },
      });
      expect(countTransitionAudits(audits, 'POSTED')).toBe(1);

      await Promise.all(
        clients.map(async (c) => {
          await c.prisma.$disconnect();
          await c.pool.end();
        }),
      );
    });

    it('20 simultaneous undo calls: exactly one succeeds, rest refuse, one audit row', async () => {
      const batchId = await seedPreviewed('conc_undo');
      await service.approve({ tenantId, batchId, actorUserId: actorId });
      await service.post({ tenantId, batchId, actorUserId: actorId });

      const N = 20;
      const barrier = createStartBarrier(N);
      const clients = Array.from({ length: N }, () => createDedicatedAppPrisma());
      const servicesN = clients.map((c) =>
        autoHospitalContext(new ImportBatchService(createTenantDb(c.prisma), clock)),
      );

      const results = await Promise.allSettled(
        servicesN.map(async (svc) => {
          await barrier();
          return svc.undo({
            tenantId,
            batchId,
            actorUserId: actorId,
            reason: 'race undo',
          });
        }),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(N - 1);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(String(r.reason)).toMatch(/expected status POSTED|Import batch refused/i);
        }
      }

      const audits = await owner.auditLog.findMany({
        where: {
          tenantId,
          entityType: 'import_batches',
          entityId: batchId,
          action: 'IMPORT_BATCH_TRANSITION',
        },
      });
      expect(countTransitionAudits(audits, 'UNDONE')).toBe(1);

      await Promise.all(
        clients.map(async (c) => {
          await c.prisma.$disconnect();
          await c.pool.end();
        }),
      );
    });

    it('approve vs fail at the same moment: exactly one wins', async () => {
      const batchId = await seedPreviewed('conc_af');
      const barrier = createStartBarrier(2);
      const a = createDedicatedAppPrisma();
      const b = createDedicatedAppPrisma();
      const svcA = autoHospitalContext(new ImportBatchService(createTenantDb(a.prisma), clock));
      const svcB = autoHospitalContext(new ImportBatchService(createTenantDb(b.prisma), clock));

      const results = await Promise.allSettled([
        (async () => {
          await barrier();
          return svcA.approve({ tenantId, batchId, actorUserId: actorId });
        })(),
        (async () => {
          await barrier();
          return svcB.fail({
            tenantId,
            batchId,
            actorUserId: actorId,
            errorMessage: 'race fail',
          });
        })(),
      ]);

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

      const final = await owner.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(['APPROVED', 'FAILED']).toContain(final.status);

      await a.prisma.$disconnect();
      await a.pool.end();
      await b.prisma.$disconnect();
      await b.pool.end();
    });
  });

  describe('privileges', () => {
    it('hospigo_app has no DELETE/TRUNCATE on import tenant tables; hq has none; import_types SELECT only', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        for (const table of ['import_batches', 'import_batch_rows', 'import_exceptions']) {
          const del = await client.query<{ ok: boolean }>(
            `SELECT has_table_privilege('hospigo_app', $1, 'DELETE') AS ok`,
            [`public.${table}`],
          );
          expect({ table, delete: del.rows[0]?.ok }).toEqual({ table, delete: false });
          const hq = await client.query<{ ok: boolean }>(
            `SELECT has_table_privilege('hospigo_hq', $1, 'SELECT') AS ok`,
            [`public.${table}`],
          );
          expect({ table, hqSelect: hq.rows[0]?.ok }).toEqual({ table, hqSelect: false });
        }

        const typeSel = await client.query<{ ok: boolean }>(
          `SELECT has_table_privilege('hospigo_app', 'public.import_types', 'SELECT') AS ok`,
        );
        const typeIns = await client.query<{ ok: boolean }>(
          `SELECT has_table_privilege('hospigo_app', 'public.import_types', 'INSERT') AS ok`,
        );
        const typeDel = await client.query<{ ok: boolean }>(
          `SELECT has_table_privilege('hospigo_app', 'public.import_types', 'DELETE') AS ok`,
        );
        expect(typeSel.rows[0]?.ok).toBe(true);
        expect(typeIns.rows[0]?.ok).toBe(false);
        expect(typeDel.rows[0]?.ok).toBe(false);

        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        for (const table of ['import_batches', 'import_batch_rows', 'import_exceptions']) {
          await expect(client.query(`TRUNCATE ${table}`)).rejects.toThrow();
        }
        await expect(client.query('TRUNCATE import_types')).rejects.toThrow();
        await expect(
          client.query(`DELETE FROM import_types WHERE code = 'PATIENTS'`),
        ).rejects.toThrow();
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });
  });
});
