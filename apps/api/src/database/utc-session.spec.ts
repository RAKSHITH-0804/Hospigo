import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { createAppPrisma, createOwnerPrisma } from './db-test.util';
import type { PrismaClient } from '../generated/prisma';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

/**
 * Times written by the app must be the real moment, whatever time zone the Postgres server uses.
 * Prisma fills @default(now()) columns in the app; the connection must read those digits as UTC
 * (see pg-session.ts). Without it, an IST server stores every such time 5h30 early.
 */
describe('Application connections use a UTC session', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  const code = `tz.check.${Date.now()}`;

  beforeAll(() => {
    owner = createOwnerPrisma();
    app = createAppPrisma();
  });

  afterAll(async () => {
    await owner.permission.deleteMany({ where: { code } });
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('the app and owner connections report time zone UTC', async () => {
    for (const client of [app, owner]) {
      const rows = await client.$queryRaw<Array<{ TimeZone: string }>>`SHOW timezone`;
      expect(rows[0].TimeZone).toBe('UTC');
    }
  });

  it('a time the app fills in (created_at) is the real moment, within seconds of the database clock', async () => {
    const created = await owner.permission.create({ data: { code, description: 'tz check' } });
    const rows = await owner.$queryRaw<Array<{ diff_seconds: number }>>`
      SELECT extract(epoch FROM (now() - created_at))::float8 AS diff_seconds
        FROM permissions WHERE id = ${created.id}`;
    // Before the fix on an IST server this was about 19800 seconds (5h30).
    expect(Math.abs(rows[0].diff_seconds)).toBeLessThan(60);
  });
});
