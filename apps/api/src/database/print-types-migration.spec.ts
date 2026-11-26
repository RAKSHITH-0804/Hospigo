import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { createOwnerPrisma, createPgClient, requireTestDatabaseUrl } from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

/**
 * Step 2.1a migration: templates saved as "prescription" (which were the full patient report) are
 * copied to PATIENT_REPORT and the old row is retired, never deleted. The copy statements are taken
 * from the migration file itself and run again here on a hospital that has such a template.
 */
describe('print types migration: old prescription templates move to the patient report (hospigo_test)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(120_000);
  const owner = createOwnerPrisma();
  const stamp = Date.now();
  let tenant: string;
  let userId: string;
  let branchId: string;

  beforeAll(async () => {
    const hospital = await owner.hospital.create({
      data: {
        code: `PTM_${stamp}`,
        name: 'Print types migration',
        isTest: true,
        branches: {
          create: [{ code: 'MAIN', name: 'Main', isMain: true, accessCode: `ptm-${stamp}` }],
        },
      },
      include: { branches: true },
    });
    tenant = hospital.id;
    branchId = hospital.branches[0]!.id;
    userId = (
      await owner.user.create({
        data: {
          tenantId: tenant,
          code: `U${stamp}`.slice(0, 40),
          email: `ptm_${stamp}@example.test`,
          displayName: 'Person',
          passwordHash: 'x',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await owner.$disconnect();
  });

  it('copies each saved prescription template (hospital and branch) to PATIENT_REPORT and retires the old rows', async () => {
    const layout = {
      version: 3,
      fontSizePt: 10,
      offset: { xMm: 0, yMm: 0 },
      elements: [],
      marker: stamp,
    };
    for (const branch of [null, branchId]) {
      await owner.printTemplate.create({
        data: {
          tenantId: tenant,
          branchId: branch,
          docType: 'PRESCRIPTION',
          paper: 'A4',
          layout,
          createdBy: userId,
          updatedBy: userId,
        },
      });
    }
    const sql = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../prisma/migrations/20261129091000_symptoms_card_paper/migration.sql',
      ),
      'utf8',
    );
    const start = sql.indexOf('INSERT INTO "print_templates"');
    const end = sql.indexOf('-- one live template per scope');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    // only this hospital's rows, so the test never touches another hospital
    const copyStatements = sql
      .slice(start, end)
      .replace(
        'WHERE "doc_type" = \'PRESCRIPTION\';',
        `WHERE "doc_type" = 'PRESCRIPTION' AND "tenant_id" = '${tenant}';`,
      )
      .replace(
        'WHERE "doc_type" = \'PRESCRIPTION\';',
        `WHERE "doc_type" = 'PRESCRIPTION' AND "tenant_id" = '${tenant}';`,
      );
    const c = createPgClient('owner');
    await c.connect();
    try {
      // the migration already ran on this database; the new rows above are live, so run the copy now
      await c.query(copyStatements.replace(/^[\s\S]*?(?=INSERT INTO)/, ''));
    } finally {
      await c.end();
    }
    const rows = await owner.printTemplate.findMany({ where: { tenantId: tenant } });
    const reports = rows.filter((r) => r.docType === 'PATIENT_REPORT');
    const old = rows.filter((r) => r.docType === 'PRESCRIPTION');
    expect(reports).toHaveLength(2);
    expect(reports.map((r) => r.branchId).sort()).toEqual([branchId, null].sort());
    for (const r of reports) {
      expect(r.retiredAt).toBeNull();
      expect(r.layout).toMatchObject({ marker: stamp });
      expect(r.paper).toBe('A4');
    }
    expect(old).toHaveLength(2);
    expect(old.every((r) => r.retiredAt !== null)).toBe(true);
  });
});
