import 'dotenv/config';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createOwnerPrisma, createPgClient, requireTestDatabaseUrl } from './db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('stored_images and uhid_counters: delete and truncate are refused for every login (hospigo_test)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(60_000);

  const owner = createOwnerPrisma();
  const stamp = Date.now();
  let tenant = '';
  let user = '';
  let imageId = '';

  beforeAll(async () => {
    const hospital = await owner.hospital.create({
      data: {
        code: `IUP_${stamp}`,
        name: 'Image Uhid Protect',
        isTest: true,
        branches: {
          create: [{ code: 'MAIN', name: 'Main', isMain: true, accessCode: `iup-${stamp}` }],
        },
      },
    });
    tenant = hospital.id;
    user = (
      await owner.user.create({
        data: {
          tenantId: tenant,
          code: `IUP${stamp}`.slice(0, 40),
          email: `iup_${stamp}@example.test`,
          displayName: 'U',
          passwordHash: 'x',
        },
      })
    ).id;
    imageId = randomUUID();
    await owner.$executeRawUnsafe(
      `INSERT INTO stored_images (id, tenant_id, purpose, content_type, byte_size, width, height,
                                  sha256, storage_key, created_by)
       VALUES ($1, $2, 'HOSPITAL_LOGO', 'image/png', 10, 1, 1, repeat('a', 64), $3, $4)`,
      imageId,
      tenant,
      `iup/${stamp}.png`,
      user,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO uhid_counters (tenant_id, period_year, last_number) VALUES ($1, 2099, 10)`,
      tenant,
    );
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  async function run(role: 'app' | 'owner', sql: string, params: unknown[] = []): Promise<void> {
    const c = createPgClient(role);
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant]);
      await c.query(sql, params);
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {
      await c.end();
    }
  }

  it('the owner role cannot delete or truncate stored pictures (a trigger, not only a missing grant)', async () => {
    await expect(
      run('owner', `DELETE FROM stored_images WHERE id = $1`, [imageId]),
    ).rejects.toThrow(/append-only/i);
    await expect(run('owner', `TRUNCATE stored_images`)).rejects.toThrow(/truncate refused/i);
    await expect(
      run('app', `DELETE FROM stored_images WHERE id = $1`, [imageId]),
    ).rejects.toThrow();
    expect(await owner.storedImage.count({ where: { id: imageId } })).toBe(1);
  });

  it('a picture still only changes is_current (the 7e guard is untouched)', async () => {
    await run('app', `UPDATE stored_images SET is_current = false WHERE id = $1`, [imageId]);
    await expect(
      run('owner', `UPDATE stored_images SET byte_size = 11 WHERE id = $1`, [imageId]),
    ).rejects.toThrow(/cannot be edited/i);
  });

  it('the owner role cannot delete or truncate UHID counters', async () => {
    await expect(
      run('owner', `DELETE FROM uhid_counters WHERE tenant_id = $1`, [tenant]),
    ).rejects.toThrow(/append-only/i);
    await expect(run('owner', `TRUNCATE uhid_counters`)).rejects.toThrow(/truncate refused/i);
    await expect(
      run('app', `DELETE FROM uhid_counters WHERE tenant_id = $1`, [tenant]),
    ).rejects.toThrow();
  });

  it('a UHID counter can still be raised, never lowered', async () => {
    await run('app', `UPDATE uhid_counters SET last_number = 20 WHERE tenant_id = $1`, [tenant]);
    await expect(
      run('app', `UPDATE uhid_counters SET last_number = 5 WHERE tenant_id = $1`, [tenant]),
    ).rejects.toThrow(/raise-only/i);
    const row = await owner.uhidCounter.findFirstOrThrow({ where: { tenantId: tenant } });
    expect(row.lastNumber).toBe(BigInt(20));
  });
});
