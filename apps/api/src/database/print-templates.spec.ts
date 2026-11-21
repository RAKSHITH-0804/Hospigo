import 'dotenv/config';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import type { Client } from 'pg';
import {
  createOwnerPrisma,
  createPgClient,
  requireTestDatabaseUrl,
  withTenant,
} from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

type Fixture = { tenant: string; main: string; east: string; user: string; user2: string };

describe('print templates (database rules, hospigo_test)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(120_000);
  const owner = createOwnerPrisma();
  const stamp = Date.now();
  let A: Fixture;
  let B: Fixture;

  async function seedHospital(label: string): Promise<Fixture> {
    const hospital = await owner.hospital.create({
      data: {
        code: `PTD_${label}_${stamp}`,
        name: `Print DB ${label}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `ptd-${label}-m-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `ptd-${label}-e-${stamp}` },
          ],
        },
      },
      include: { branches: true },
    });
    const user = (key: string) =>
      owner.user.create({
        data: {
          tenantId: hospital.id,
          code: `${key}${label}${stamp}`.slice(0, 40),
          email: `ptd_${key}_${label}_${stamp}@example.test`,
          displayName: key,
          passwordHash: 'x',
        },
      });
    return {
      tenant: hospital.id,
      main: hospital.branches.find((b) => b.code === 'MAIN')!.id,
      east: hospital.branches.find((b) => b.code === 'EAST')!.id,
      user: (await user('U1')).id,
      user2: (await user('U2')).id,
    };
  }

  beforeAll(async () => {
    A = await seedHospital('A');
    B = await seedHospital('B');
  });
  afterAll(async () => {
    await owner.$disconnect();
  });

  async function inTenant<T>(tenant: string, fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createPgClient('app');
    await c.connect();
    try {
      return await withTenant(c, tenant, () => fn(c));
    } finally {
      await c.end();
    }
  }
  async function asOwner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = createPgClient('owner');
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }
  const refused = (p: Promise<unknown>, pattern: RegExp) => expect(p).rejects.toThrow(pattern);

  type Over = Partial<{
    doc: string;
    branch: string | null;
    paper: string;
    width: number | null;
    height: number | null;
    margin: number;
    layout: string;
    preset: string | null;
    by: string;
  }>;
  const insert = (c: Client, f: Fixture, o: Over = {}) => {
    const id = randomUUID();
    return c
      .query(
        `INSERT INTO print_templates (id, tenant_id, branch_id, doc_type, paper, width_mm, height_mm,
                margin_top_mm, margin_right_mm, margin_bottom_mm, margin_left_mm, layout, preset,
                created_by, updated_by)
         VALUES ($1, $2, $3, $4::print_doc_type, $5::print_paper, $6, $7, $8, $8, $8, $8, $9::jsonb, $10, $11, $11)`,
        [
          id,
          f.tenant,
          o.branch === undefined ? null : o.branch,
          o.doc ?? 'RECEIPT',
          o.paper ?? 'A5',
          o.width === undefined ? null : o.width,
          o.height === undefined ? null : o.height,
          o.margin ?? 10,
          o.layout ?? '{}',
          o.preset === undefined ? null : o.preset,
          o.by ?? f.user,
        ],
      )
      .then(() => id);
  };

  it('stores a standard paper without a size, and a label or custom paper with one', async () => {
    const f = await seedHospital('S');
    await inTenant(f.tenant, async (c) => {
      await insert(c, f, { doc: 'RECEIPT', paper: 'A5' });
      await insert(c, f, { doc: 'REGISTRATION_SLIP', paper: 'LABEL', width: 100, height: 50 });
      await insert(c, f, { doc: 'PRESCRIPTION', paper: 'CUSTOM', width: 241.3, height: 139.7 });
    });
    expect(await owner.printTemplate.count({ where: { tenantId: f.tenant } })).toBe(3);
  });

  it('refuses a paper and a size that do not belong together', async () => {
    for (const o of [
      { paper: 'A5', width: 148, height: 210 },
      { paper: 'A4', width: 210, height: null },
      { paper: 'LABEL', width: 100, height: null },
      { paper: 'CUSTOM', width: null, height: null },
    ] as Over[]) {
      await refused(
        inTenant(A.tenant, (c) => insert(c, A, o)),
        /print_templates_paper_size_chk/,
      );
    }
  });

  it('refuses sizes and margins outside their limits', async () => {
    for (const [o, check] of [
      [{ paper: 'CUSTOM', width: 19.9, height: 100 }, /size_range_chk/],
      [{ paper: 'CUSTOM', width: 100, height: 1000.1 }, /size_range_chk/],
      [{ margin: -0.1 }, /margins_chk/],
      [{ margin: 100.1 }, /margins_chk/],
    ] as Array<[Over, RegExp]>) {
      await refused(
        inTenant(A.tenant, (c) => insert(c, A, { doc: 'PRESCRIPTION', ...o })),
        check,
      );
    }
    await inTenant(A.tenant, (c) => insert(c, A, { doc: 'PRESCRIPTION', margin: 100 }));
  });

  it('the layout must be a JSON object of bounded size, a preset name a short text', async () => {
    for (const layout of ['[]', '"x"', '5', 'null']) {
      await refused(
        inTenant(B.tenant, (c) => insert(c, B, { doc: 'REGISTRATION_SLIP', layout })),
        /layout_chk|not-null|null value/,
      );
    }
    await refused(
      inTenant(B.tenant, (c) =>
        insert(c, B, {
          doc: 'REGISTRATION_SLIP',
          layout: JSON.stringify({ t: 'x'.repeat(16100) }),
        }),
      ),
      /layout_chk/,
    );
    await refused(
      inTenant(B.tenant, (c) => insert(c, B, { doc: 'REGISTRATION_SLIP', preset: '   ' })),
      /preset_chk/,
    );
    await refused(
      inTenant(B.tenant, (c) => insert(c, B, { doc: 'REGISTRATION_SLIP', preset: 'x'.repeat(41) })),
      /preset_chk/,
    );
  });

  it('one template per hospital (or branch) and document; a different branch or document is fine', async () => {
    const f = await seedHospital('U');
    await inTenant(f.tenant, (c) => insert(c, f, { doc: 'RECEIPT' }));
    await refused(
      inTenant(f.tenant, (c) => insert(c, f, { doc: 'RECEIPT' })),
      /print_templates_scope_doc_key|duplicate key/,
    );
    await inTenant(f.tenant, (c) => insert(c, f, { doc: 'PRESCRIPTION' }));
    await inTenant(f.tenant, (c) => insert(c, f, { doc: 'RECEIPT', branch: f.main }));
    await inTenant(f.tenant, (c) => insert(c, f, { doc: 'RECEIPT', branch: f.east }));
    await refused(
      inTenant(f.tenant, (c) => insert(c, f, { doc: 'RECEIPT', branch: f.main })),
      /print_templates_scope_doc_key|duplicate key/,
    );
  });

  it('a branch must belong to the same hospital', async () => {
    await refused(
      inTenant(A.tenant, (c) => insert(c, A, { doc: 'REGISTRATION_SLIP', branch: B.main })),
      /foreign key|violates/i,
    );
  });

  it('the identity never changes; the settings do, and only the setting columns are open to the app', async () => {
    const f = await seedHospital('G');
    const id = await inTenant(f.tenant, (c) => insert(c, f, { doc: 'RECEIPT' }));
    // settings: allowed
    await inTenant(f.tenant, (c) =>
      c.query(
        `UPDATE print_templates SET enabled = false, paper = 'A4', margin_top_mm = 12.5, mode = 'PREPRINTED',
                layout = '{"fontSizePt": 9}'::jsonb, updated_by = $2, updated_at = now() WHERE id = $1`,
        [id, f.user2],
      ),
    );
    const row = await owner.printTemplate.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({
      enabled: false,
      paper: 'A4',
      mode: 'PREPRINTED',
      updatedBy: f.user2,
    });
    expect(Number(row.marginTopMm.toString())).toBe(12.5);
    // identity columns: the app role has no UPDATE on them at all
    for (const set of [
      `doc_type = 'PRESCRIPTION'`,
      `tenant_id = '${B.tenant}'`,
      `branch_id = '${f.main}'`,
      `created_by = '${f.user2}'`,
      `created_at = now()`,
      `id = 'other'`,
    ]) {
      await refused(
        inTenant(f.tenant, (c) => c.query(`UPDATE print_templates SET ${set} WHERE id = $1`, [id])),
        /permission denied|row-level security|immutable/i,
      );
    }
    // even the owner cannot change the identity (the trigger)
    await refused(
      asOwner((c) =>
        c.query(`UPDATE print_templates SET doc_type = 'PRESCRIPTION' WHERE id = $1`, [id]),
      ),
      /identity columns are immutable/,
    );
    await refused(
      asOwner((c) =>
        c.query(`UPDATE print_templates SET created_by = $2 WHERE id = $1`, [id, f.user2]),
      ),
      /identity columns are immutable/,
    );
  });

  it('the app can delete a template (a reset to the default); nobody can truncate the table', async () => {
    const f = await seedHospital('D');
    const id = await inTenant(f.tenant, (c) => insert(c, f, { doc: 'RECEIPT' }));
    await inTenant(f.tenant, (c) => c.query(`DELETE FROM print_templates WHERE id = $1`, [id]));
    expect(await owner.printTemplate.count({ where: { id } })).toBe(0);
    await refused(
      asOwner((c) => c.query('TRUNCATE print_templates')),
      /cannot|not allowed|refus|append/i,
    );
  });

  it('hospitals are isolated by row level security, and hq and patient roles have no privileges', async () => {
    const f = await seedHospital('R');
    const id = await inTenant(f.tenant, (c) => insert(c, f, { doc: 'RECEIPT' }));
    // another hospital sees nothing and can neither change nor delete it
    const seen = await inTenant(B.tenant, (c) =>
      c.query(`SELECT count(*)::int AS n FROM print_templates WHERE tenant_id = $1`, [f.tenant]),
    );
    expect(seen.rows[0].n).toBe(0);
    const touched = await inTenant(B.tenant, async (c) => {
      const u = await c.query(`UPDATE print_templates SET enabled = false WHERE id = $1`, [id]);
      const d = await c.query(`DELETE FROM print_templates WHERE id = $1`, [id]);
      return [u.rowCount, d.rowCount];
    });
    expect(touched).toEqual([0, 0]);
    await refused(
      inTenant(B.tenant, (c) => insert(c, f, { doc: 'PRESCRIPTION' })),
      /row-level security/i,
    );
    expect(await owner.printTemplate.count({ where: { id, enabled: true } })).toBe(1);
    await asOwner(async (c) => {
      for (const role of ['hospigo_hq', 'hospigo_patient']) {
        const r = await c.query<{ s: boolean; i: boolean; u: boolean; d: boolean }>(
          `SELECT has_table_privilege($1, 'public.print_templates', 'SELECT') AS s,
                  has_table_privilege($1, 'public.print_templates', 'INSERT') AS i,
                  has_table_privilege($1, 'public.print_templates', 'UPDATE') AS u,
                  has_table_privilege($1, 'public.print_templates', 'DELETE') AS d`,
          [role],
        );
        expect({ role, ...r.rows[0] }).toEqual({ role, s: false, i: false, u: false, d: false });
      }
      const rls = await c.query<{ on: boolean; forced: boolean }>(
        `SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'print_templates'`,
      );
      expect(rls.rows[0]).toEqual({ on: true, forced: true });
    });
  });
});
