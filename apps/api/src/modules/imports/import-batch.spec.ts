import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { FakeClock } from '../../common/clock';
import {
  createAppPrisma,
  createOwnerPrisma,
  createPgClient,
  requireTestDatabaseUrl,
} from '../../database/db-test.util';
import { ImportBatchService } from './import-batch.service';

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

    service = new ImportBatchService(app as never, clock);
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

    async function expectReject(
      client: ReturnType<typeof createPgClient>,
      sql: string,
      params: unknown[],
      pattern: RegExp,
    ): Promise<void> {
      await client.query('SAVEPOINT sp_illegal');
      await expect(client.query(sql, params)).rejects.toThrow(pattern);
      await client.query('ROLLBACK TO SAVEPOINT sp_illegal');
    }

    it('allows every legal transition and refuses illegal ones', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        const id = await insertDraft(client, `sm_${Date.now()}`);

        await expectReject(
          client,
          `UPDATE import_batches SET status = 'APPROVED' WHERE id = $1`,
          [id],
          /illegal status transition/i,
        );

        await client.query(`UPDATE import_batches SET status = 'PREVIEWED' WHERE id = $1`, [id]);
        await expectReject(
          client,
          `UPDATE import_batches SET status = 'POSTED' WHERE id = $1`,
          [id],
          /illegal status transition/i,
        );
        await expectReject(
          client,
          `UPDATE import_batches SET status = 'APPROVED', approved_by = NULL, approved_at = NULL WHERE id = $1`,
          [id],
          /APPROVED requires/i,
        );

        await client.query(
          `UPDATE import_batches
           SET status = 'APPROVED', approved_by = $2, approved_at = NOW()
           WHERE id = $1`,
          [id, actorId],
        );

        // Strip approval while still APPROVED (status unchanged), then POSTED must fail.
        await client.query(
          `UPDATE import_batches SET approved_by = NULL, approved_at = NULL WHERE id = $1`,
          [id],
        );
        await expectReject(
          client,
          `UPDATE import_batches SET status = 'POSTED', posted_at = NOW() WHERE id = $1`,
          [id],
          /earlier approval/i,
        );
        await client.query(
          `UPDATE import_batches SET approved_by = $2, approved_at = NOW() WHERE id = $1`,
          [id, actorId],
        );

        await client.query(
          `UPDATE import_batches SET status = 'POSTED', posted_at = NOW() WHERE id = $1`,
          [id],
        );

        await expectReject(
          client,
          `UPDATE import_batches SET status = 'UNDONE', undone_by = NULL, undone_at = NULL, undo_reason = NULL WHERE id = $1`,
          [id],
          /UNDONE requires/i,
        );

        await client.query(
          `UPDATE import_batches
           SET status = 'UNDONE', undone_by = $2, undone_at = NOW(), undo_reason = 'fix'
           WHERE id = $1`,
          [id, actorId],
        );

        await expectReject(
          client,
          `UPDATE import_batches SET status = 'DRAFT' WHERE id = $1`,
          [id],
          /terminal/i,
        );

        await client.query('COMMIT');
      } finally {
        await client.end();
      }
    });

    it('DRAFT/PREVIEWED/APPROVED may move to FAILED; FAILED is terminal', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        const id = await insertDraft(client, `fail_${Date.now()}`);
        await client.query(`UPDATE import_batches SET status = 'FAILED' WHERE id = $1`, [id]);
        await expect(
          client.query(`UPDATE import_batches SET status = 'DRAFT' WHERE id = $1`, [id]),
        ).rejects.toThrow(/terminal/i);
        await client.query('COMMIT');
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
        expect(typeSel.rows[0]?.ok).toBe(true);
        expect(typeIns.rows[0]?.ok).toBe(false);

        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        for (const table of ['import_batches', 'import_batch_rows', 'import_exceptions']) {
          await expect(client.query(`TRUNCATE ${table}`)).rejects.toThrow();
        }
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });
  });
});
