import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';

prepareTestEnv();

/**
 * Step 2.1b: an Admin who looks after TWO branches gets a branch switcher limited to those
 * branches; an Admin of one branch gets none; a hospital-wide SuperAdmin keeps all branches.
 */
describe('branch switcher for an Admin with several branches (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date());
  let app: INestApplication;
  let h: KitHospital;
  let third: string;
  let two: { token: string; id: string };
  let one: string;
  let wide: string;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    const kit = createKit(owner, booted.tokens);
    h = await kit.hospital('SW');
    // a third branch that the two-branch Admin does not hold
    const extra = await owner.branch.create({
      data: {
        tenantId: h.tenant,
        code: 'THIRD',
        name: 'Third',
        isMain: false,
        accessCode: `sw-third-${Date.now()}`,
      },
    });
    third = extra.id;
    const twoAdmin = await kit.person(h, 'two', [h.main, h.east], {
      roleId: h.branchAdminRoleId,
      scope: 'BRANCH',
    });
    two = { token: twoAdmin.token(h.main), id: twoAdmin.id };
    one = (
      await kit.person(h, 'one', [h.main], { roleId: h.branchAdminRoleId, scope: 'BRANCH' })
    ).token(h.main);
    wide = (
      await kit.person(h, 'wide', [h.main], { roleId: h.superAdminRoleId, scope: 'HOSPITAL' })
    ).token(h.main);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it('lists only the branches the Admin holds (never the third one)', async () => {
    const res = await http().get('/auth/switchable-branches').set(auth(two.token)).expect(200);
    expect(res.body.map((b: { id: string }) => b.id).sort()).toEqual([h.main, h.east].sort());
    expect(res.body.find((b: { id: string }) => b.id === h.main).isCurrent).toBe(true);
  });

  it('an Admin of one branch has no switcher (403), a hospital-wide person sees every branch', async () => {
    await http().get('/auth/switchable-branches').set(auth(one)).expect(403);
    const res = await http().get('/auth/switchable-branches').set(auth(wide)).expect(200);
    expect(res.body.map((b: { id: string }) => b.id).sort()).toEqual(
      [h.main, h.east, third].sort(),
    );
  });

  it('/auth/me: canSwitchBranch for several branches, hospitalWide only for the hospital-wide role', async () => {
    const meTwo = await http().get('/auth/me').set(auth(two.token)).expect(200);
    expect(meTwo.body).toMatchObject({ canSwitchBranch: true, hospitalWide: false });
    const meOne = await http().get('/auth/me').set(auth(one)).expect(200);
    expect(meOne.body).toMatchObject({ canSwitchBranch: false, hospitalWide: false });
    const meWide = await http().get('/auth/me').set(auth(wide)).expect(200);
    expect(meWide.body).toMatchObject({ canSwitchBranch: true, hospitalWide: true });
  });

  it('a branch assignment that is switched off takes the branch away at once', async () => {
    await owner.roleAssignmentBranch.updateMany({
      where: { tenantId: h.tenant, branchId: h.east, assignment: { userId: two.id } },
      data: { isActive: false },
    });
    // one branch left: no longer a switcher
    await http().get('/auth/switchable-branches').set(auth(two.token)).expect(403);
    await owner.roleAssignmentBranch.updateMany({
      where: { tenantId: h.tenant, branchId: h.east, assignment: { userId: two.id } },
      data: { isActive: true },
    });
    await http().get('/auth/switchable-branches').set(auth(two.token)).expect(200);
  });
});
