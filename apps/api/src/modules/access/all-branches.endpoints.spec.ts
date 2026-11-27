import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';
import { AuthRedisService } from '../auth/auth-redis.service';
import type { TokenService } from '../auth/token.service';

prepareTestEnv();
process.env.AUTH_IP_RATE_LIMIT_PER_MIN = '1000';

/**
 * Phase 2.2: an Admin with several branches. Hospital A has three branches; Admin1 holds branches 1 and
 * 2, Admin2 holds branch 3 only, and a person of another hospital holds the same permissions there.
 * "All my branches" (branch=ALL) on the dashboard, the OPD queue and the refund requests shows exactly
 * the assigned branches and is refused for anyone with fewer than two.
 */
describe('All my branches (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let tokens: TokenService;
  let A: KitHospital;
  let B: KitHospital;
  let third: string;
  let admin1: { main: string; east: string };
  let admin2: string;
  let otherAdmin: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const PERMS = ['opd.queue.read', 'opd.billing.read', 'opd.visits.read', 'opd.refunds.approve'];

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    tokens = booted.tokens;
    app.get(AuthRedisService).setKeyPrefix(`allbr-test-${Date.now()}:`);
    const kit = createKit(owner, tokens);
    A = await kit.hospital('AB');
    B = await kit.hospital('AC');
    const extra = await owner.branch.create({
      data: {
        tenantId: A.tenant,
        code: `THIRD${Date.now() % 100000}`,
        name: 'Third',
        accessCode: `third-${Date.now()}`,
        isMain: false,
      },
    });
    third = extra.id;
    const opd = await owner.module.findFirstOrThrow({ where: { code: 'OPD' } });
    await owner.branchModule.create({
      data: { tenantId: A.tenant, branchId: third, moduleId: opd.id, enabledByIndigo: true },
    });
    const a1 = await kit.person(A, 'adm1', [A.main, A.east], {
      permissions: PERMS,
      scope: 'BRANCH',
    });
    admin1 = { main: a1.token(A.main), east: a1.token(A.east) };
    admin2 = (await kit.person(A, 'adm2', [third], { permissions: PERMS, scope: 'BRANCH' })).token(
      third,
    );
    otherAdmin = (
      await kit.person(B, 'adm3', [B.main, B.east], { permissions: PERMS, scope: 'BRANCH' })
    ).token(B.main);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('the dashboard counts exactly the assigned branches; one branch is refused', async () => {
    const all = await http()
      .get('/dashboard/summary?branch=ALL')
      .set(auth(admin1.main))
      .expect(200);
    expect(all.body.scope).toBe('ALL');
    expect([...all.body.branchIds].sort()).toEqual([A.main, A.east].sort());
    expect(all.body.branchIds).not.toContain(third);
    const single = await http().get('/dashboard/summary').set(auth(admin1.main)).expect(200);
    expect(single.body.scope).toBe('BRANCH');
    expect(single.body.branchIds).toEqual([A.main]);
    expect((await http().get('/dashboard/summary?branch=ALL').set(auth(admin2))).status).toBe(403);
    // another hospital's person sees only that hospital's branches
    const other = await http()
      .get('/dashboard/summary?branch=ALL')
      .set(auth(otherAdmin))
      .expect(200);
    expect([...other.body.branchIds].sort()).toEqual([B.main, B.east].sort());
    expect(other.body.branchIds).not.toContain(A.main);
  });

  it('the OPD queue and the refund requests: combined for two or more branches, refused for one', async () => {
    for (const path of ['/opd/queue?branch=ALL', '/opd/refund-requests?branch=ALL']) {
      expect([path, (await http().get(path).set(auth(admin1.east))).status]).toEqual([path, 200]);
      expect([path, (await http().get(path).set(auth(admin2))).status]).toEqual([path, 403]);
      expect([path, (await http().get(path).set(auth(otherAdmin))).status]).toEqual([path, 200]);
    }
    expect((await http().get('/opd/queue?branch=ALL').set(auth(admin1.main))).body.scope).toBe(
      'ALL',
    );
    // only the word ALL is accepted, never a branch id
    for (const path of ['/opd/queue', '/opd/refund-requests', '/dashboard/summary']) {
      expect((await http().get(`${path}?branch=${third}`).set(auth(admin1.main))).status).toBe(400);
    }
  });

  it('Admin2 never sees the branches of Admin1 and the pending count stays inside the assignment', async () => {
    const mine = await http().get('/dashboard/summary').set(auth(admin2)).expect(200);
    expect(mine.body.branchIds).toEqual([third]);
    const count = await http()
      .get('/opd/refund-requests/pending-count')
      .set(auth(admin2))
      .expect(200);
    expect(typeof count.body.count).toBe('number');
  });
});
