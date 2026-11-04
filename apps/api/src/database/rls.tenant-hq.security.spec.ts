import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import type { Client } from 'pg';
import { createOwnerPrisma, createPgClient, GLOBAL_TABLES, withTenant } from './db-test.util';

loadEnv({ path: path.resolve(__dirname, '../../../../.env') });

type Priv = { select: boolean; insert: boolean; update: boolean; delete: boolean };

/**
 * Explicit HQ table privilege map.
 * Any future clinical or patient table must NOT be added to this map.
 */
const HQ_ALLOWED: Record<string, Priv> = {
  hospitals: { select: true, insert: true, update: true, delete: true },
  branches: { select: true, insert: true, update: true, delete: true },
  hospital_module_subscriptions: { select: true, insert: true, update: true, delete: true },
  branch_modules: { select: true, insert: true, update: true, delete: true },
  // Narrow first-SuperAdmin needs: HQ may append audit only; user/role writes go through SECURITY DEFINER.
  audit_logs: { select: false, insert: true, update: false, delete: false },
};

const INSERT_REFUSAL_TABLES = [
  'branches',
  'users',
  'roles',
  'role_assignments',
  'user_branches',
  'branch_modules',
  'hospital_module_subscriptions',
  'audit_logs',
  'hospital_settings',
] as const;

function newId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

async function listTenantTables(client: Client): Promise<string[]> {
  const result = await client.query<{ relname: string }>(`
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
    ORDER BY 1
  `);
  return result.rows.map((r) => r.relname).filter((name) => !GLOBAL_TABLES.has(name));
}

async function tableHasColumn(client: Client, table: string, column: string): Promise<boolean> {
  const r = await client.query(
    `
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
    `,
    [table, column],
  );
  return (r.rowCount ?? 0) > 0;
}

describe('Tenant isolation + HQ security (hospigo_test only)', () => {
  const prisma = createOwnerPrisma();
  let tenantA: string;
  let tenantB: string;
  let branchA: string;
  let branchB: string;
  let moduleId: string;
  /** Subscribed on B, no branch_modules row (branch_modules INSERT probe). */
  let moduleIdForBranchInsert: string;
  /** Not subscribed on B (hospital_module_subscriptions INSERT probe). */
  let moduleIdForSubInsert: string;
  let permissionId: string;
  /** Sample row ids on tenant B, keyed by table name. */
  const sampleB: Record<string, string> = {};
  let superHospitalId: string;
  let inactiveHospitalId: string;
  let suspendedHospitalId: string;
  let raceHospitalId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    const hospitalA = await prisma.hospital.create({
      data: {
        code: `ISO_A_${stamp}`,
        name: 'Isolation A',
        accessCode: `iso-a-${stamp}`,
        isTest: true,
        branches: { create: { code: 'MAIN', name: 'Main', isMain: true } },
      },
      include: { branches: true },
    });
    const hospitalB = await prisma.hospital.create({
      data: {
        code: `ISO_B_${stamp}`,
        name: 'Isolation B',
        accessCode: `iso-b-${stamp}`,
        isTest: true,
        branches: { create: { code: 'MAIN', name: 'Main', isMain: true } },
      },
      include: { branches: true },
    });
    tenantA = hospitalA.id;
    tenantB = hospitalB.id;
    branchA = hospitalA.branches[0]!.id;
    branchB = hospitalB.branches[0]!.id;
    sampleB.hospitals = tenantB;
    sampleB.branches = branchB;

    const module = await prisma.module.create({
      data: { code: `ISO_M_${stamp}`, name: 'Isolation Module' },
    });
    moduleId = module.id;
    const moduleBranchInsert = await prisma.module.create({
      data: { code: `ISO_MB_${stamp}`, name: 'Isolation Module Branch Insert' },
    });
    moduleIdForBranchInsert = moduleBranchInsert.id;
    const moduleSubInsert = await prisma.module.create({
      data: { code: `ISO_MS_${stamp}`, name: 'Isolation Module Sub Insert' },
    });
    moduleIdForSubInsert = moduleSubInsert.id;

    const permission = await prisma.permission.create({
      data: { code: `ISO_P_${stamp}`, description: 'isolation' },
    });
    permissionId = permission.id;

    const setting = await prisma.hospitalSetting.create({
      data: {
        tenantId: tenantB,
        key: `iso_key_${stamp}`,
        value: { ok: true },
        effectiveFrom: new Date(),
      },
    });
    sampleB.hospital_settings = setting.id;

    const sub = await prisma.hospitalModuleSubscription.create({
      data: { tenantId: tenantB, moduleId },
    });
    sampleB.hospital_module_subscriptions = sub.id;
    await prisma.hospitalModuleSubscription.create({
      data: { tenantId: tenantB, moduleId: moduleIdForBranchInsert },
    });

    const bm = await prisma.branchModule.create({
      data: { tenantId: tenantB, branchId: branchB, moduleId },
    });
    sampleB.branch_modules = bm.id;

    const role = await prisma.role.create({
      data: {
        tenantId: tenantB,
        code: `ISO_ROLE_${stamp}`,
        name: 'Isolation Role',
      },
    });
    sampleB.roles = role.id;

    const rp = await prisma.rolePermission.create({
      data: { tenantId: tenantB, roleId: role.id, permissionId },
    });
    sampleB.role_permissions = rp.id;

    const user = await prisma.user.create({
      data: {
        tenantId: tenantB,
        code: `ISO_U_${stamp}`,
        email: `iso_u_${stamp}@example.test`,
        displayName: 'Isolation User',
        passwordHash: 'test-hash-not-a-secret',
      },
    });
    sampleB.users = user.id;

    const ub = await prisma.userBranch.create({
      data: { tenantId: tenantB, userId: user.id, branchId: branchB },
    });
    sampleB.user_branches = ub.id;

    const assignment = await prisma.roleAssignment.create({
      data: {
        tenantId: tenantB,
        userId: user.id,
        roleId: role.id,
        scopeType: 'HOSPITAL',
      },
    });
    sampleB.role_assignments = assignment.id;

    const rab = await prisma.roleAssignmentBranch.create({
      data: {
        tenantId: tenantB,
        assignmentId: assignment.id,
        branchId: branchB,
      },
    });
    sampleB.role_assignment_branches = rab.id;

    const audit = await prisma.auditLog.create({
      data: {
        tenantId: tenantB,
        action: 'ISO_SAMPLE',
        entityType: 'test',
        entityId: user.id,
      },
    });
    sampleB.audit_logs = audit.id;

    // Hospital with SUPER_ADMIN role ready for first-SuperAdmin (no assignment yet).
    const superHospital = await prisma.hospital.create({
      data: {
        code: `ISO_SA_${stamp}`,
        name: 'SuperAdmin Target',
        accessCode: `iso-sa-${stamp}`,
        isTest: true,
        status: 'ACTIVE',
        branches: { create: { code: 'MAIN', name: 'Main', isMain: true } },
        roles: {
          create: {
            code: 'SUPER_ADMIN',
            name: 'Super Admin',
            isSystem: true,
          },
        },
      },
    });
    superHospitalId = superHospital.id;

    const inactive = await prisma.hospital.create({
      data: {
        code: `ISO_IN_${stamp}`,
        name: 'Inactive Target',
        accessCode: `iso-in-${stamp}`,
        isTest: true,
        status: 'INACTIVE',
        isActive: false,
        branches: { create: { code: 'MAIN', name: 'Main', isMain: true } },
        roles: {
          create: {
            code: 'SUPER_ADMIN',
            name: 'Super Admin',
            isSystem: true,
          },
        },
      },
    });
    inactiveHospitalId = inactive.id;

    const suspended = await prisma.hospital.create({
      data: {
        code: `ISO_SU_${stamp}`,
        name: 'Suspended Target',
        accessCode: `iso-su-${stamp}`,
        isTest: true,
        status: 'SUSPENDED',
        isActive: true,
        branches: { create: { code: 'MAIN', name: 'Main', isMain: true } },
        roles: {
          create: {
            code: 'SUPER_ADMIN',
            name: 'Super Admin',
            isSystem: true,
          },
        },
      },
    });
    suspendedHospitalId = suspended.id;

    const raceHospital = await prisma.hospital.create({
      data: {
        code: `ISO_RC_${stamp}`,
        name: 'Race Target',
        accessCode: `iso-rc-${stamp}`,
        isTest: true,
        status: 'ACTIVE',
        branches: { create: { code: 'MAIN', name: 'Main', isMain: true } },
        roles: {
          create: {
            code: 'SUPER_ADMIN',
            name: 'Super Admin',
            isSystem: true,
          },
        },
      },
    });
    raceHospitalId = raceHospital.id;

    // Samples for Step 3b-1 tenant tables (picked up by the full-table isolation loop).
    const catalog = await prisma.patientFieldCatalog.upsert({
      where: { key: 'name' },
      create: {
        key: 'name',
        defaultLabel: 'Full name',
        dataType: 'TEXT',
        canDisable: false,
        alwaysRequired: true,
      },
      update: {},
    });
    const fieldSetting = await prisma.patientFieldSetting.create({
      data: {
        tenantId: tenantB,
        catalogKey: catalog.key,
        isEnabled: true,
        isRequired: true,
        label: catalog.defaultLabel,
        sortOrder: 0,
      },
    });
    sampleB.patient_field_settings = fieldSetting.id;

    const customField = await prisma.patientCustomField.create({
      data: {
        tenantId: tenantB,
        code: `cf_${stamp}`,
        label: 'Custom',
        dataType: 'TEXT',
      },
    });
    sampleB.patient_custom_fields = customField.id;

    const option = await prisma.patientCustomFieldOption.create({
      data: {
        tenantId: tenantB,
        fieldId: customField.id,
        label: 'Opt',
        sortOrder: 1,
      },
    });
    sampleB.patient_custom_field_options = option.id;

    const patient = await prisma.patient.create({
      data: {
        tenantId: tenantB,
        uhid: `ISOUHID${stamp}`,
        registeredBranchId: branchB,
        name: 'Isolation Patient',
        createdBy: sampleB.users,
      },
    });
    sampleB.patients = patient.id;

    const cfv = await prisma.patientCustomFieldValue.create({
      data: {
        tenantId: tenantB,
        patientId: patient.id,
        fieldId: customField.id,
        valueText: 'x',
      },
    });
    sampleB.patient_custom_field_values = cfv.id;

    const ident = await prisma.patientIdentifier.create({
      data: {
        tenantId: tenantB,
        patientId: patient.id,
        identifierType: 'TEST',
        valueEncrypted: Buffer.from('x'),
        valueHash: `hash_${stamp}`,
        last4: '0000',
      },
    });
    sampleB.patient_identifiers = ident.id;

    const uhidCfg = await prisma.uhidFormatConfig.create({
      data: {
        tenantId: tenantB,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        resetRule: 'NEVER',
        fyStartMonth: 4,
        timezone: 'Asia/Kolkata',
        createdBy: sampleB.users,
        blocks: {
          create: [
            { position: 1, blockType: 'FIXED_TEXT', textValue: 'X' },
            { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 3 },
          ],
        },
      },
      include: { blocks: true },
    });
    sampleB.uhid_format_configs = uhidCfg.id;
    sampleB.uhid_format_blocks = uhidCfg.blocks[0]!.id;

    await prisma.uhidCounter.create({
      data: { tenantId: tenantB, periodYear: 0, lastNumber: 0n },
    });
    sampleB.uhid_counters = 'composite';

    // Samples for Step 3b-2 import tables.
    const importType = await prisma.importType.upsert({
      where: { code: `ISO_IMP_${stamp}` },
      create: { code: `ISO_IMP_${stamp}`, name: 'Isolation import type' },
      update: {},
    });
    const batch = await prisma.importBatch.create({
      data: {
        tenantId: tenantB,
        importTypeId: importType.id,
        branchId: branchB,
        templateVersion: '1',
        fileStorageKey: `tenants/${tenantB}/imports/iso.xlsx`,
        fileSha256: `sha_iso_${stamp}`,
        fileNameOriginal: 'iso.xlsx',
        createdBy: sampleB.users,
      },
    });
    sampleB.import_batches = batch.id;
    const batchRow = await prisma.importBatchRow.create({
      data: {
        tenantId: tenantB,
        batchId: batch.id,
        rowNumber: 1,
        matchKey: 'CODE1',
        rawValues: { code: 'CODE1' },
      },
    });
    sampleB.import_batch_rows = batchRow.id;
    const iex = await prisma.importException.create({
      data: {
        tenantId: tenantB,
        batchId: batch.id,
        rowId: batchRow.id,
        reasonCode: 'UNMATCHED',
        message: 'no match',
      },
    });
    sampleB.import_exceptions = iex.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('every tenant table has FORCE RLS and app policies cover USING + WITH CHECK on app.tenant_id', async () => {
    const client = createPgClient('owner');
    await client.connect();
    try {
      const tables = await listTenantTables(client);
      expect(tables.length).toBeGreaterThan(0);

      for (const table of tables) {
        const force = await client.query<{ ok: boolean }>(
          `
          SELECT (c.relrowsecurity AND c.relforcerowsecurity) AS ok
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relname = $1
          `,
          [table],
        );
        expect(force.rows[0]?.ok).toBe(true);

        const policies = await client.query<{
          policyname: string;
          cmd: string;
          qual: string | null;
          with_check: string | null;
          roles: string[];
        }>(
          `
          SELECT policyname, cmd, qual, with_check, roles
          FROM pg_policies
          WHERE schemaname = 'public' AND tablename = $1
          `,
          [table],
        );

        const appPolicies = policies.rows.filter(
          (p) => p.roles.includes('hospigo_app') || p.roles.includes('public'),
        );
        expect(appPolicies.length).toBeGreaterThan(0);

        const hasUsing = appPolicies.some(
          (p) => typeof p.qual === 'string' && p.qual.includes('app.tenant_id'),
        );
        const hasCheck = appPolicies.some(
          (p) => typeof p.with_check === 'string' && p.with_check.includes('app.tenant_id'),
        );
        expect({ table, hasUsing, hasCheck }).toEqual({ table, hasUsing: true, hasCheck: true });
      }
    } finally {
      await client.end();
    }
  });

  it('tenant A select sees zero tenant-B rows; unset tenant sees zero', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const owner = createPgClient('owner');
      await owner.connect();
      const tables = await listTenantTables(owner);
      await owner.end();

      for (const table of tables) {
        expect(sampleB[table]).toBeDefined();

        const hasTenantId = await tableHasColumn(client, table, 'tenant_id');
        const hasId = await tableHasColumn(client, table, 'id');
        const bFilter = hasTenantId
          ? `tenant_id = '${tenantB.replace(/'/g, "''")}'`
          : `id = '${tenantB.replace(/'/g, "''")}'`;
        const selectList = hasId ? 'id' : 'tenant_id';

        const asA = await withTenant(client, tenantA, async () => {
          const r = await client.query(
            `SELECT ${selectList} FROM ${quoteIdent(table)} WHERE ${bFilter}`,
          );
          return r.rowCount ?? 0;
        });
        expect({ table, asA }).toEqual({ table, asA: 0 });

        const unset = await withTenant(client, null, async () => {
          const r = await client.query(`SELECT ${selectList} FROM ${quoteIdent(table)}`);
          return r.rowCount ?? 0;
        });
        expect({ table, unset }).toEqual({ table, unset: 0 });
      }
    } finally {
      await client.end();
    }
  });

  it('tenant A update/delete of tenant-B rows affects 0 rows (or is denied)', async () => {
    const client = createPgClient('app');
    await client.connect();
    try {
      const owner = createPgClient('owner');
      await owner.connect();
      const tables = await listTenantTables(owner);
      await owner.end();

      for (const table of tables) {
        const sampleId = sampleB[table];
        expect(sampleId).toBeDefined();
        const hasId = await tableHasColumn(client, table, 'id');

        const canUpdate = await client.query<{ ok: boolean }>(
          `SELECT has_table_privilege('hospigo_app', $1, 'UPDATE') AS ok`,
          [`public.${table}`],
        );
        const canDelete = await client.query<{ ok: boolean }>(
          `SELECT has_table_privilege('hospigo_app', $1, 'DELETE') AS ok`,
          [`public.${table}`],
        );

        await withTenant(client, tenantA, async () => {
          if (canUpdate.rows[0]?.ok) {
            let upd;
            if (!hasId && table === 'uhid_counters') {
              upd = await client.query(
                `UPDATE uhid_counters SET last_number = last_number
                 WHERE tenant_id = $1 AND period_year = 0 RETURNING tenant_id`,
                [tenantB],
              );
            } else {
              const hasIsActive = await tableHasColumn(client, table, 'is_active');
              upd = hasIsActive
                ? await client.query(
                    `UPDATE ${quoteIdent(table)} SET is_active = is_active WHERE id = $1 RETURNING id`,
                    [sampleId],
                  )
                : await client.query(
                    `UPDATE ${quoteIdent(table)} SET tenant_id = tenant_id WHERE id = $1 RETURNING id`,
                    [sampleId],
                  );
            }
            expect({ table, updated: upd.rowCount }).toEqual({ table, updated: 0 });
          } else {
            await expect(
              hasId
                ? client.query(`UPDATE ${quoteIdent(table)} SET id = id WHERE id = $1`, [sampleId])
                : client.query(
                    `UPDATE uhid_counters SET last_number = last_number WHERE tenant_id = $1`,
                    [tenantB],
                  ),
            ).rejects.toThrow();
          }

          if (canDelete.rows[0]?.ok) {
            const del = hasId
              ? await client.query(`DELETE FROM ${quoteIdent(table)} WHERE id = $1 RETURNING id`, [
                  sampleId,
                ])
              : await client.query(
                  `DELETE FROM uhid_counters WHERE tenant_id = $1 AND period_year = 0 RETURNING tenant_id`,
                  [tenantB],
                );
            expect({ table, deleted: del.rowCount }).toEqual({ table, deleted: 0 });
          } else {
            await expect(
              hasId
                ? client.query(`DELETE FROM ${quoteIdent(table)} WHERE id = $1`, [sampleId])
                : client.query(
                    `DELETE FROM uhid_counters WHERE tenant_id = $1 AND period_year = 0`,
                    [tenantB],
                  ),
            ).rejects.toThrow();
          }
        });
      }
    } finally {
      await client.end();
    }
  });

  it('INSERT with foreign tenant_id while context is A is refused for key tables', async () => {
    const stamp = Date.now();
    for (const table of INSERT_REFUSAL_TABLES) {
      // Fresh connection per probe: a failed statement aborts the PG transaction.
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA]);
        const sql = insertSqlForForeignTenant(table, {
          tenantB,
          branchB,
          moduleIdForBranchInsert,
          moduleIdForSubInsert,
          stamp,
          roleId: sampleB.roles,
          userId: sampleB.users,
        });
        await expect(client.query(sql.text, sql.values)).rejects.toThrow(
          /row-level security|policy/i,
        );
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    }
    void branchA;
    void moduleId;
    void permissionId;
  });

  it('hq_create_first_superadmin succeeds once, refuses duplicate/unknown/inactive, writes hospital-scope SuperAdmin + audit', async () => {
    const hq = createPgClient('hq');
    await hq.connect();
    try {
      const code = `SA_${Date.now()}`;
      const email = `sa_${Date.now()}@example.test`;
      const first = await hq.query<{ hq_create_first_superadmin: string }>(
        `SELECT hq_create_first_superadmin($1, $2, $3, $4, $5)`,
        [superHospitalId, code, email, 'First Super', 'test-hash-not-a-secret'],
      );
      const userId = first.rows[0]!.hq_create_first_superadmin;
      expect(userId).toBeTruthy();

      const owner = createPgClient('owner');
      await owner.connect();
      try {
        const user = await owner.query<{ tenant_id: string; email: string }>(
          `SELECT tenant_id, email FROM users WHERE id = $1`,
          [userId],
        );
        expect(user.rows[0]?.tenant_id).toBe(superHospitalId);
        expect(user.rows[0]?.email).toBe(email.toLowerCase());

        const assignment = await owner.query<{ scope_type: string; role_code: string }>(
          `
          SELECT ra.scope_type::text AS scope_type, r.code AS role_code
          FROM role_assignments ra
          JOIN roles r ON r.tenant_id = ra.tenant_id AND r.id = ra.role_id
          WHERE ra.tenant_id = $1 AND ra.user_id = $2 AND ra.is_active = true
          `,
          [superHospitalId, userId],
        );
        expect(assignment.rows).toHaveLength(1);
        expect(assignment.rows[0]?.scope_type).toBe('HOSPITAL');
        expect(assignment.rows[0]?.role_code).toBe('SUPER_ADMIN');

        const audit = await owner.query(
          `
          SELECT 1 FROM audit_logs
          WHERE tenant_id = $1
            AND action = 'CREATE_FIRST_SUPERADMIN'
            AND entity_type = 'users'
            AND entity_id = $2
          `,
          [superHospitalId, userId],
        );
        expect(audit.rowCount).toBe(1);
      } finally {
        await owner.end();
      }

      await expect(
        hq.query(`SELECT hq_create_first_superadmin($1, $2, $3, $4, $5)`, [
          superHospitalId,
          `${code}_2`,
          `other_${email}`,
          'Second Super',
          'test-hash-not-a-secret',
        ]),
      ).rejects.toThrow(/already has a SuperAdmin/i);

      await expect(
        hq.query(`SELECT hq_create_first_superadmin($1, $2, $3, $4, $5)`, [
          newId(),
          `UNK_${Date.now()}`,
          `unk_${Date.now()}@example.test`,
          'Unknown',
          'test-hash-not-a-secret',
        ]),
      ).rejects.toThrow();

      await expect(
        hq.query(`SELECT hq_create_first_superadmin($1, $2, $3, $4, $5)`, [
          inactiveHospitalId,
          `IN_${Date.now()}`,
          `in_${Date.now()}@example.test`,
          'Inactive Super',
          'test-hash-not-a-secret',
        ]),
      ).rejects.toThrow();
    } finally {
      await hq.end();
    }
  });

  it('hq_create_first_superadmin refuses inactive hospital', async () => {
    const hq = createPgClient('hq');
    await hq.connect();
    try {
      await expect(
        hq.query(`SELECT hq_create_first_superadmin($1, $2, $3, $4, $5)`, [
          inactiveHospitalId,
          `IN2_${Date.now()}`,
          `in2_${Date.now()}@example.test`,
          'Inactive Super 2',
          'test-hash-not-a-secret',
        ]),
      ).rejects.toThrow(/not active/i);
    } finally {
      await hq.end();
    }
  });

  it('hq_create_first_superadmin refuses SUSPENDED hospital', async () => {
    const hq = createPgClient('hq');
    await hq.connect();
    try {
      await expect(
        hq.query(`SELECT hq_create_first_superadmin($1, $2, $3, $4, $5)`, [
          suspendedHospitalId,
          `SU_${Date.now()}`,
          `su_${Date.now()}@example.test`,
          'Suspended Super',
          'test-hash-not-a-secret',
        ]),
      ).rejects.toThrow(/not active/i);
    } finally {
      await hq.end();
    }
  });

  it('concurrent hq_create_first_superadmin calls yield exactly one SuperAdmin', async () => {
    const stamp = Date.now();
    const call = async (n: number) => {
      const hq = createPgClient('hq');
      await hq.connect();
      try {
        return await hq.query<{ hq_create_first_superadmin: string }>(
          `SELECT hq_create_first_superadmin($1, $2, $3, $4, $5)`,
          [
            raceHospitalId,
            `RC_${stamp}_${n}`,
            `rc_${stamp}_${n}@example.test`,
            `Race Super ${n}`,
            'test-hash-not-a-secret',
          ],
        );
      } finally {
        await hq.end();
      }
    };

    const results = await Promise.allSettled([call(1), call(2)]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeTruthy();

    const owner = createPgClient('owner');
    await owner.connect();
    try {
      const admins = await owner.query(
        `
        SELECT ra.id
        FROM role_assignments ra
        JOIN roles r ON r.tenant_id = ra.tenant_id AND r.id = ra.role_id
        WHERE ra.tenant_id = $1
          AND r.code = 'SUPER_ADMIN'
          AND ra.is_active = true
        `,
        [raceHospitalId],
      );
      expect(admins.rowCount).toBe(1);
    } finally {
      await owner.end();
    }
  });

  it('hospigo_hq privileges match explicit allowlist for every public table', async () => {
    const client = createPgClient('owner');
    await client.connect();
    try {
      const tables = await client.query<{ relname: string }>(`
        SELECT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY 1
      `);

      for (const { relname } of tables.rows) {
        const allowed = HQ_ALLOWED[relname] ?? {
          select: false,
          insert: false,
          update: false,
          delete: false,
        };
        const actual = await client.query<Priv>(
          `
          SELECT
            has_table_privilege('hospigo_hq', $1, 'SELECT') AS select,
            has_table_privilege('hospigo_hq', $1, 'INSERT') AS insert,
            has_table_privilege('hospigo_hq', $1, 'UPDATE') AS update,
            has_table_privilege('hospigo_hq', $1, 'DELETE') AS delete
          `,
          [`public.${relname}`],
        );
        expect({ table: relname, priv: actual.rows[0] }).toEqual({
          table: relname,
          priv: allowed,
        });
      }
    } finally {
      await client.end();
    }
  });
});

function quoteIdent(ident: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(ident)) {
    throw new Error(`Refusing unsafe identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function insertSqlForForeignTenant(
  table: (typeof INSERT_REFUSAL_TABLES)[number],
  ctx: {
    tenantB: string;
    branchB: string;
    moduleIdForBranchInsert: string;
    moduleIdForSubInsert: string;
    stamp: number;
    roleId: string;
    userId: string;
  },
): { text: string; values: unknown[] } {
  const id = newId();
  switch (table) {
    case 'branches':
      return {
        text: `INSERT INTO branches (id, tenant_id, code, name, is_main, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, 'X', false, true, NOW(), NOW())`,
        values: [id, ctx.tenantB, `X_${ctx.stamp}`],
      };
    case 'users':
      return {
        text: `INSERT INTO users (id, tenant_id, code, email, display_name, password_hash, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, 'X', 'h', true, NOW(), NOW())`,
        values: [id, ctx.tenantB, `XU_${ctx.stamp}`, `xu_${ctx.stamp}@example.test`],
      };
    case 'roles':
      return {
        text: `INSERT INTO roles (id, tenant_id, code, name, is_system, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, 'X', false, true, NOW(), NOW())`,
        values: [id, ctx.tenantB, `XR_${ctx.stamp}`],
      };
    case 'role_assignments':
      return {
        text: `INSERT INTO role_assignments (id, tenant_id, user_id, role_id, scope_type, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, 'HOSPITAL', true, NOW(), NOW())`,
        values: [id, ctx.tenantB, ctx.userId, ctx.roleId],
      };
    case 'user_branches':
      return {
        text: `INSERT INTO user_branches (id, tenant_id, user_id, branch_id, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, true, NOW(), NOW())`,
        values: [id, ctx.tenantB, ctx.userId, ctx.branchB],
      };
    case 'hospital_module_subscriptions':
      return {
        text: `INSERT INTO hospital_module_subscriptions (id, tenant_id, module_id, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, true, NOW(), NOW())`,
        values: [id, ctx.tenantB, ctx.moduleIdForSubInsert],
      };
    case 'branch_modules':
      return {
        text: `INSERT INTO branch_modules (id, tenant_id, branch_id, module_id, enabled_by_indigo, restricted_by_hospital, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, $4, true, false, true, NOW(), NOW())`,
        values: [id, ctx.tenantB, ctx.branchB, ctx.moduleIdForBranchInsert],
      };
    case 'audit_logs':
      return {
        text: `INSERT INTO audit_logs (id, tenant_id, action, entity_type, created_at)
               VALUES ($1, $2, 'X', 'x', NOW())`,
        values: [id, ctx.tenantB],
      };
    case 'hospital_settings':
      return {
        text: `INSERT INTO hospital_settings (id, tenant_id, key, value, effective_from, is_active, created_at, updated_at)
               VALUES ($1, $2, $3, '{}'::jsonb, NOW(), true, NOW(), NOW())`,
        values: [id, ctx.tenantB, `x_${ctx.stamp}`],
      };
    default: {
      const _exhaustive: never = table;
      throw new Error(`unhandled insert table: ${_exhaustive}`);
    }
  }
}
