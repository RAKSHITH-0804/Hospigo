import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Client } from 'pg';
import { Pool } from 'pg';
import { FakeClock } from '../../common/clock';
import {
  autoHospitalContext,
  createAppPrisma,
  createOwnerPrisma,
  createPgClient,
  createTenantDb,
  requireTestDatabaseUrl,
} from '../../database/db-test.util';
import { PrismaClient } from '../../generated/prisma';
import { PatientFieldsService } from './patient-fields.service';
import { PatientsService } from './patients.service';
import { UhidService } from './uhid.service';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

function pageConfig(): ConfigService {
  return {
    get: (key: string) => (key === 'PATIENT_SEARCH_MAX_PAGE_SIZE' ? 10 : undefined),
    getOrThrow: () => {
      throw new Error('unexpected');
    },
  } as unknown as ConfigService;
}

function makePatients(prisma: PrismaClient, clock: FakeClock): PatientsService {
  const tenantDb = createTenantDb(prisma);
  const fields = new PatientFieldsService(tenantDb);
  const uhid = new UhidService(tenantDb, clock);
  return autoHospitalContext(new PatientsService(tenantDb, fields, uhid, pageConfig() as never));
}

/** One Prisma client + dedicated 1-connection pool (true separate TCP connection). */
function createDedicatedAppPrisma(): { prisma: PrismaClient; pool: Pool } {
  const pool = new Pool({ connectionString: requireTestDatabaseUrl(), max: 1 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  return { prisma, pool };
}

/** All callers wait until `total` have arrived, then proceed together. */
function createStartBarrier(total: number): () => Promise<void> {
  let arrived = 0;
  const waiters: Array<() => void> = [];
  return () =>
    new Promise<void>((resolve) => {
      waiters.push(resolve);
      arrived += 1;
      if (arrived >= total) {
        for (const w of waiters) {
          w();
        }
      }
    });
}

describe('UHID database-level rules + true concurrency (hospigo_test only)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(120_000);

  const owner = createOwnerPrisma();
  let tenantId: string;
  let actorId: string;

  beforeAll(async () => {
    const stamp = Date.now();
    await owner.patientFieldCatalog.upsert({
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

    const hospital = await owner.hospital.create({
      data: {
        code: `UDB_${stamp}`,
        name: 'UHID DB Rule Hospital',
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `udb-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `udb-${stamp}-east` },
          ],
        },
      },
      include: { branches: true },
    });
    tenantId = hospital.id;

    const actor = await owner.user.create({
      data: {
        tenantId,
        code: `UDBA_${stamp}`,
        email: `udba_${stamp}@example.test`,
        displayName: 'DB Actor',
        passwordHash: 'x',
      },
    });
    actorId = actor.id;

    for (const c of await owner.patientFieldCatalog.findMany()) {
      await owner.patientFieldSetting.create({
        data: {
          tenantId,
          catalogKey: c.key,
          isEnabled: true,
          isRequired: c.alwaysRequired,
          label: c.defaultLabel,
          sortOrder: 0,
          changedBy: actorId,
        },
      });
    }

    await owner.uhidFormatConfig.create({
      data: {
        tenantId,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        resetRule: 'NEVER',
        fyStartMonth: 4,
        timezone: 'Asia/Kolkata',
        createdBy: actorId,
        blocks: {
          create: [
            { position: 1, blockType: 'FIXED_TEXT', textValue: 'CONC' },
            { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 4 },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  describe('deferred constraint triggers (raw SQL, owner)', () => {
    async function withOwnerTx(fn: (client: Client) => Promise<void>): Promise<void> {
      const client = createPgClient('owner');
      await client.connect();
      try {
        await client.query('BEGIN');
        await fn(client);
        await client.query('COMMIT');
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* already aborted */
        }
        throw error;
      } finally {
        await client.end();
      }
    }

    it('COMMIT refuses FINANCIAL_YEAR reset_rule without a FINANCIAL_YEAR block', async () => {
      const stamp = Date.now();
      const configId = `cfg_nofy_${stamp}`;
      await expect(
        withOwnerTx(async (client) => {
          await client.query(
            `INSERT INTO uhid_format_configs
              (id, tenant_id, effective_from, reset_rule, fy_start_month, timezone, created_by)
             VALUES ($1, $2, TIMESTAMPTZ '2000-01-01', 'FINANCIAL_YEAR', 4, 'Asia/Kolkata', $3)`,
            [configId, tenantId, actorId],
          );
          await client.query(
            `INSERT INTO uhid_format_blocks
              (id, tenant_id, config_id, position, block_type, text_value, min_width)
             VALUES
              ($1, $2, $3, 1, 'FIXED_TEXT', 'X', NULL),
              ($4, $2, $3, 2, 'RUNNING_NUMBER', NULL, 3)`,
            [`blk_a_${stamp}`, tenantId, configId, `blk_b_${stamp}`],
          );
        }),
      ).rejects.toThrow(/FINANCIAL_YEAR/);
    });

    it('COMMIT refuses deleting the FINANCIAL_YEAR block from a valid FINANCIAL_YEAR config', async () => {
      const stamp = Date.now();
      const configId = `cfg_rmfy_${stamp}`;
      const fyBlockId = `blk_fy_${stamp}`;

      // Assemble a valid FY config in its own committed transaction.
      await withOwnerTx(async (client) => {
        await client.query(
          `INSERT INTO uhid_format_configs
            (id, tenant_id, effective_from, reset_rule, fy_start_month, timezone, created_by)
           VALUES ($1, $2, TIMESTAMPTZ '2000-01-01', 'FINANCIAL_YEAR', 4, 'Asia/Kolkata', $3)`,
          [configId, tenantId, actorId],
        );
        await client.query(
          `INSERT INTO uhid_format_blocks
            (id, tenant_id, config_id, position, block_type, text_value, fy_style, min_width)
           VALUES
            ($1, $2, $3, 1, 'FINANCIAL_YEAR', NULL, 'SHORT', NULL),
            ($4, $2, $3, 2, 'SEPARATOR', '/', NULL, NULL),
            ($5, $2, $3, 3, 'RUNNING_NUMBER', NULL, NULL, 5)`,
          [fyBlockId, tenantId, configId, `blk_sep_${stamp}`, `blk_rn_${stamp}`],
        );
      });

      await expect(
        withOwnerTx(async (client) => {
          await client.query(`DELETE FROM uhid_format_blocks WHERE id = $1`, [fyBlockId]);
        }),
      ).rejects.toThrow(/FINANCIAL_YEAR/);
    });

    it('COMMIT refuses a format config with zero RUNNING_NUMBER blocks', async () => {
      const stamp = Date.now();
      const configId = `cfg_zorn_${stamp}`;
      await expect(
        withOwnerTx(async (client) => {
          await client.query(
            `INSERT INTO uhid_format_configs
              (id, tenant_id, effective_from, reset_rule, fy_start_month, timezone, created_by)
             VALUES ($1, $2, TIMESTAMPTZ '2000-01-01', 'NEVER', 4, 'Asia/Kolkata', $3)`,
            [configId, tenantId, actorId],
          );
          await client.query(
            `INSERT INTO uhid_format_blocks
              (id, tenant_id, config_id, position, block_type, text_value)
             VALUES ($1, $2, $3, 1, 'FIXED_TEXT', 'ONLY')`,
            [`blk_only_${stamp}`, tenantId, configId],
          );
        }),
      ).rejects.toThrow(/RUNNING_NUMBER/);
    });

    it('COMMIT refuses a format config with two RUNNING_NUMBER blocks', async () => {
      const stamp = Date.now();
      const configId = `cfg_tworn_${stamp}`;
      await expect(
        withOwnerTx(async (client) => {
          await client.query(
            `INSERT INTO uhid_format_configs
              (id, tenant_id, effective_from, reset_rule, fy_start_month, timezone, created_by)
             VALUES ($1, $2, TIMESTAMPTZ '2000-01-01', 'NEVER', 4, 'Asia/Kolkata', $3)`,
            [configId, tenantId, actorId],
          );
          await client.query(
            `INSERT INTO uhid_format_blocks
              (id, tenant_id, config_id, position, block_type, min_width)
             VALUES
              ($1, $2, $3, 1, 'RUNNING_NUMBER', 3),
              ($4, $2, $3, 2, 'RUNNING_NUMBER', 3)`,
            [`blk_rn1_${stamp}`, tenantId, configId, `blk_rn2_${stamp}`],
          );
        }),
      ).rejects.toThrow(/RUNNING_NUMBER/);
    });
  });

  describe('uhid_counters raise-only trigger', () => {
    beforeAll(async () => {
      await owner.uhidCounter.upsert({
        where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
        create: { tenantId, periodYear: 0, lastNumber: 10n },
        update: {},
      });
      // Ensure a known baseline without decreasing (raise if needed).
      const row = await owner.uhidCounter.findUniqueOrThrow({
        where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
      });
      if (row.lastNumber < 10n) {
        await owner.uhidCounter.update({
          where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
          data: { lastNumber: 10n },
        });
      }
    });

    it('owner raw UPDATE decreasing last_number is refused by the trigger', async () => {
      const client = createPgClient('owner');
      await client.connect();
      try {
        await expect(
          client.query(
            `UPDATE uhid_counters SET last_number = last_number - 1
             WHERE tenant_id = $1 AND period_year = 0`,
            [tenantId],
          ),
        ).rejects.toThrow(/cannot be decreased/i);
      } finally {
        await client.end();
      }
    });

    it('hospigo_app raw UPDATE decreasing last_number is refused by the trigger', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        await expect(
          client.query(
            `UPDATE uhid_counters SET last_number = last_number - 1
             WHERE tenant_id = $1 AND period_year = 0`,
            [tenantId],
          ),
        ).rejects.toThrow(/cannot be decreased/i);
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });

    it('owner and hospigo_app may increase last_number', async () => {
      const before = await owner.uhidCounter.findUniqueOrThrow({
        where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
      });

      const ownerClient = createPgClient('owner');
      await ownerClient.connect();
      try {
        await ownerClient.query(
          `UPDATE uhid_counters SET last_number = last_number + 1
           WHERE tenant_id = $1 AND period_year = 0`,
          [tenantId],
        );
      } finally {
        await ownerClient.end();
      }

      const mid = await owner.uhidCounter.findUniqueOrThrow({
        where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
      });
      expect(mid.lastNumber).toBe(before.lastNumber + 1n);

      const appClient = createPgClient('app');
      await appClient.connect();
      try {
        await appClient.query('BEGIN');
        await appClient.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        await appClient.query(
          `UPDATE uhid_counters SET last_number = last_number + 1
           WHERE tenant_id = $1 AND period_year = 0`,
          [tenantId],
        );
        await appClient.query('COMMIT');
      } finally {
        await appClient.end();
      }

      const after = await owner.uhidCounter.findUniqueOrThrow({
        where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
      });
      expect(after.lastNumber).toBe(before.lastNumber + 2n);
    });
  });

  describe('hospigo_app privileges: no DELETE/TRUNCATE; configs immutable', () => {
    it('hospigo_app has no DELETE privilege on uhid_counters, uhid_format_configs, uhid_format_blocks', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        for (const table of ['uhid_counters', 'uhid_format_configs', 'uhid_format_blocks']) {
          const res = await client.query<{ ok: boolean }>(
            `SELECT has_table_privilege('hospigo_app', $1, 'DELETE') AS ok`,
            [`public.${table}`],
          );
          expect({ table, delete: res.rows[0]?.ok }).toEqual({ table, delete: false });
        }
      } finally {
        await client.end();
      }
    });

    it('hospigo_app cannot TRUNCATE uhid_counters, uhid_format_configs, uhid_format_blocks', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        for (const table of ['uhid_counters', 'uhid_format_configs', 'uhid_format_blocks']) {
          await expect(client.query(`TRUNCATE ${table}`)).rejects.toThrow();
        }
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });

    it('hospigo_app cannot UPDATE or DELETE uhid_format_configs (immutable)', async () => {
      const cfg = await owner.uhidFormatConfig.findFirstOrThrow({ where: { tenantId } });
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

        await expect(
          client.query(`UPDATE uhid_format_configs SET timezone = timezone WHERE id = $1`, [
            cfg.id,
          ]),
        ).rejects.toThrow();

        await expect(
          client.query(`DELETE FROM uhid_format_configs WHERE id = $1`, [cfg.id]),
        ).rejects.toThrow();

        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });

    it('hospigo_app cannot UPDATE or DELETE uhid_format_blocks (immutable)', async () => {
      const block = await owner.uhidFormatBlock.findFirstOrThrow({ where: { tenantId } });
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

        await expect(
          client.query(`UPDATE uhid_format_blocks SET text_value = text_value WHERE id = $1`, [
            block.id,
          ]),
        ).rejects.toThrow();

        await expect(
          client.query(`DELETE FROM uhid_format_blocks WHERE id = $1`, [block.id]),
        ).rejects.toThrow();

        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });

    it('hospigo_app cannot DELETE from uhid_counters', async () => {
      const client = createPgClient('app');
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
        await expect(
          client.query(`DELETE FROM uhid_counters WHERE tenant_id = $1 AND period_year = 0`, [
            tenantId,
          ]),
        ).rejects.toThrow();
        await client.query('ROLLBACK');
      } finally {
        await client.end();
      }
    });
  });

  describe('true concurrency across separate connections', () => {
    it('50 registrations on 50 separate Prisma clients (start barrier) yield consecutive UHIDs', async () => {
      // Reset counter to a known start for this hospital's NEVER period.
      const stamp = Date.now();
      const hospital = await owner.hospital.create({
        data: {
          code: `C50_${stamp}`,
          name: 'Concurrency 50 Hospital',
          isTest: true,
          branches: {
            create: [
              { code: 'MAIN', name: 'Main', isMain: true, accessCode: `c50-${stamp}` },
              { code: 'EAST', name: 'East', isMain: false, accessCode: `c50-${stamp}-east` },
            ],
          },
        },
        include: { branches: true },
      });
      const actor = await owner.user.create({
        data: {
          tenantId: hospital.id,
          code: 'C50A',
          email: `c50a_${stamp}@example.test`,
          displayName: 'C50',
          passwordHash: 'x',
        },
      });
      for (const c of await owner.patientFieldCatalog.findMany()) {
        await owner.patientFieldSetting.create({
          data: {
            tenantId: hospital.id,
            catalogKey: c.key,
            isEnabled: true,
            isRequired: c.alwaysRequired,
            label: c.defaultLabel,
            sortOrder: 0,
            changedBy: actor.id,
          },
        });
      }
      await owner.uhidFormatConfig.create({
        data: {
          tenantId: hospital.id,
          effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
          resetRule: 'NEVER',
          fyStartMonth: 4,
          timezone: 'Asia/Kolkata',
          createdBy: actor.id,
          blocks: {
            create: [
              { position: 1, blockType: 'FIXED_TEXT', textValue: 'P50' },
              { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 4 },
            ],
          },
        },
      });

      const main = hospital.branches.find((b) => b.code === 'MAIN')!.id;
      const east = hospital.branches.find((b) => b.code === 'EAST')!.id;
      const clock = new FakeClock(new Date('2026-06-15T12:00:00.000Z'));
      const barrier = createStartBarrier(50);
      const dedicated = Array.from({ length: 50 }, () => createDedicatedAppPrisma());

      try {
        const jobs = dedicated.map(async ({ prisma }, i) => {
          const patients = makePatients(prisma, clock);
          await barrier();
          return patients.register({
            tenantId: hospital.id,
            registeredBranchId: i % 2 === 0 ? main : east,
            createdBy: actor.id,
            name: `Parallel ${i}`,
          });
        });

        const results = await Promise.all(jobs);
        const uhids = results.map((r) => r.uhid);
        expect(new Set(uhids).size).toBe(50);
        const numbers = uhids.map((u) => Number(u.replace('P50', ''))).sort((a, b) => a - b);
        expect(numbers[0]).toBe(1);
        expect(numbers[49]).toBe(50);
        expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));

        const counter = await owner.uhidCounter.findUniqueOrThrow({
          where: { tenantId_periodYear: { tenantId: hospital.id, periodYear: 0 } },
        });
        expect(counter.lastNumber).toBe(50n);
      } finally {
        await Promise.all(
          dedicated.map(async ({ prisma, pool }) => {
            await prisma.$disconnect();
            await pool.end();
          }),
        );
      }
    });

    it('two separate Prisma clients (simulated API servers) share one hospital counter safely', async () => {
      const stamp = Date.now();
      const hospital = await owner.hospital.create({
        data: {
          code: `C2S_${stamp}`,
          name: 'Two Server Hospital',
          isTest: true,
          branches: {
            create: [
              { code: 'MAIN', name: 'Main', isMain: true, accessCode: `c2s-${stamp}` },
              { code: 'EAST', name: 'East', isMain: false, accessCode: `c2s-${stamp}-east` },
            ],
          },
        },
        include: { branches: true },
      });
      const actor = await owner.user.create({
        data: {
          tenantId: hospital.id,
          code: 'C2SA',
          email: `c2sa_${stamp}@example.test`,
          displayName: 'C2S',
          passwordHash: 'x',
        },
      });
      for (const c of await owner.patientFieldCatalog.findMany()) {
        await owner.patientFieldSetting.create({
          data: {
            tenantId: hospital.id,
            catalogKey: c.key,
            isEnabled: true,
            isRequired: c.alwaysRequired,
            label: c.defaultLabel,
            sortOrder: 0,
            changedBy: actor.id,
          },
        });
      }
      await owner.uhidFormatConfig.create({
        data: {
          tenantId: hospital.id,
          effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
          resetRule: 'NEVER',
          fyStartMonth: 4,
          timezone: 'Asia/Kolkata',
          createdBy: actor.id,
          blocks: {
            create: [
              { position: 1, blockType: 'FIXED_TEXT', textValue: 'S2' },
              { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 3 },
            ],
          },
        },
      });

      const main = hospital.branches.find((b) => b.code === 'MAIN')!.id;
      const east = hospital.branches.find((b) => b.code === 'EAST')!.id;
      const clock = new FakeClock(new Date('2026-06-15T12:00:00.000Z'));
      const dedicatedA = createDedicatedAppPrisma();
      const dedicatedB = createDedicatedAppPrisma();
      const patientsA = makePatients(dedicatedA.prisma, clock);
      const patientsB = makePatients(dedicatedB.prisma, clock);
      const barrier = createStartBarrier(40);

      try {
        const jobs = Array.from({ length: 40 }, async (_, i) => {
          await barrier();
          const svc = i % 2 === 0 ? patientsA : patientsB;
          return svc.register({
            tenantId: hospital.id,
            registeredBranchId: i % 2 === 0 ? main : east,
            createdBy: actor.id,
            name: `Dual ${i}`,
          });
        });
        const results = await Promise.all(jobs);
        const numbers = results.map((r) => Number(r.uhid.replace('S2', ''))).sort((a, b) => a - b);
        expect(new Set(numbers).size).toBe(40);
        expect(numbers).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
        const counter = await owner.uhidCounter.findUniqueOrThrow({
          where: { tenantId_periodYear: { tenantId: hospital.id, periodYear: 0 } },
        });
        expect(counter.lastNumber).toBe(40n);
      } finally {
        await dedicatedA.prisma.$disconnect();
        await dedicatedA.pool.end();
        await dedicatedB.prisma.$disconnect();
        await dedicatedB.pool.end();
      }
    });
  });

  describe('NEVER vs FINANCIAL_YEAR across FY boundary', () => {
    it('NEVER hospital continues consecutive numbers across 31 Mar 23:59 → 1 Apr 00:00', async () => {
      const stamp = Date.now();
      const hospital = await owner.hospital.create({
        data: {
          code: `NVR_${stamp}`,
          name: 'Never Boundary Hospital',
          isTest: true,
          branches: {
            create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `nvr-${stamp}` },
          },
        },
        include: { branches: true },
      });
      const actor = await owner.user.create({
        data: {
          tenantId: hospital.id,
          code: 'NVRA',
          email: `nvra_${stamp}@example.test`,
          displayName: 'NVR',
          passwordHash: 'x',
        },
      });
      for (const c of await owner.patientFieldCatalog.findMany()) {
        await owner.patientFieldSetting.create({
          data: {
            tenantId: hospital.id,
            catalogKey: c.key,
            isEnabled: true,
            isRequired: c.alwaysRequired,
            label: c.defaultLabel,
            sortOrder: 0,
            changedBy: actor.id,
          },
        });
      }
      await owner.uhidFormatConfig.create({
        data: {
          tenantId: hospital.id,
          effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
          resetRule: 'NEVER',
          fyStartMonth: 4,
          timezone: 'Asia/Kolkata',
          createdBy: actor.id,
          blocks: {
            create: [
              { position: 1, blockType: 'FIXED_TEXT', textValue: 'NV' },
              { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 4 },
            ],
          },
        },
      });

      const clock = new FakeClock(new Date('2026-03-31T18:29:00.000Z')); // 31 Mar 23:59 IST
      const prisma = createAppPrisma();
      try {
        const patients = makePatients(prisma, clock);
        const before = await patients.register({
          tenantId: hospital.id,
          registeredBranchId: hospital.branches[0]!.id,
          createdBy: actor.id,
          name: 'Before boundary',
        });
        expect(before.uhid).toBe('NV0001');

        clock.set(new Date('2026-03-31T18:30:00.000Z')); // 1 Apr 00:00 IST
        const after = await patients.register({
          tenantId: hospital.id,
          registeredBranchId: hospital.branches[0]!.id,
          createdBy: actor.id,
          name: 'After boundary',
        });
        expect(after.uhid).toBe('NV0002');

        const counter = await owner.uhidCounter.findUniqueOrThrow({
          where: { tenantId_periodYear: { tenantId: hospital.id, periodYear: 0 } },
        });
        expect(counter.lastNumber).toBe(2n);
      } finally {
        await prisma.$disconnect();
      }
    });

    it('FINANCIAL_YEAR hospital restarts at 1 after 31 Mar 23:59 → 1 Apr 00:00', async () => {
      const stamp = Date.now();
      const hospital = await owner.hospital.create({
        data: {
          code: `FYB_${stamp}`,
          name: 'FY Boundary Hospital',
          isTest: true,
          branches: {
            create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `fyb-${stamp}` },
          },
        },
        include: { branches: true },
      });
      const actor = await owner.user.create({
        data: {
          tenantId: hospital.id,
          code: 'FYBA',
          email: `fyba_${stamp}@example.test`,
          displayName: 'FYB',
          passwordHash: 'x',
        },
      });
      for (const c of await owner.patientFieldCatalog.findMany()) {
        await owner.patientFieldSetting.create({
          data: {
            tenantId: hospital.id,
            catalogKey: c.key,
            isEnabled: true,
            isRequired: c.alwaysRequired,
            label: c.defaultLabel,
            sortOrder: 0,
            changedBy: actor.id,
          },
        });
      }
      await owner.uhidFormatConfig.create({
        data: {
          tenantId: hospital.id,
          effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
          resetRule: 'FINANCIAL_YEAR',
          fyStartMonth: 4,
          timezone: 'Asia/Kolkata',
          createdBy: actor.id,
          blocks: {
            create: [
              { position: 1, blockType: 'FINANCIAL_YEAR', fyStyle: 'SHORT' },
              { position: 2, blockType: 'SEPARATOR', textValue: '/' },
              { position: 3, blockType: 'RUNNING_NUMBER', minWidth: 5 },
            ],
          },
        },
      });

      const clock = new FakeClock(new Date('2026-03-31T18:29:00.000Z'));
      const prisma = createAppPrisma();
      try {
        const patients = makePatients(prisma, clock);
        const before = await patients.register({
          tenantId: hospital.id,
          registeredBranchId: hospital.branches[0]!.id,
          createdBy: actor.id,
          name: 'FY before',
        });
        expect(before.uhid.startsWith('2526/')).toBe(true);
        expect(before.uhid.endsWith('00001')).toBe(true);

        clock.set(new Date('2026-03-31T18:30:00.000Z'));
        const after = await patients.register({
          tenantId: hospital.id,
          registeredBranchId: hospital.branches[0]!.id,
          createdBy: actor.id,
          name: 'FY after',
        });
        expect(after.uhid).toBe('2627/00001');
      } finally {
        await prisma.$disconnect();
      }
    });
  });
});
