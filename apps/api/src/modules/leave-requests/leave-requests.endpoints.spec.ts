import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FakeClock } from '../../common/clock';
import { createOwnerPrisma } from '../../database/db-test.util';
import { bootApp, createKit, prepareTestEnv } from '../../database/hospital-test-kit';
import type { KitHospital } from '../../database/hospital-test-kit';

prepareTestEnv();

type Cast = {
  h: KitHospital;
  admin: string;
  adminId: string;
  branchAdmin: string; // Branch Admin of MAIN only
  nobody: string;
  docMainToken: string; // a doctor working in MAIN
  docMainProfile: string;
  docEastToken: string; // a doctor working in EAST only
  docEastProfile: string;
  docMainUserId: string;
  noProfileToken: string; // has opd.doctors.own but no doctor profile
};

describe('Doctor leave requests (HTTP, hospigo_test)', () => {
  const owner = createOwnerPrisma();
  const clock = new FakeClock(new Date('2026-11-23T04:30:00Z')); // Monday 23 Nov 2026, 10:00 IST
  let app: INestApplication;
  let A: Cast;
  let B: Cast;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const mineUrl = '/doctor-profiles/me/leave-requests';

  async function seed(label: string, kit: ReturnType<typeof createKit>): Promise<Cast> {
    const h = await kit.hospital(label);
    const cast = await kit.cast(h);
    const doctor = async (key: string, branch: string) => {
      const p = await kit.person(h, key, [branch], {
        permissions: ['opd.doctors.own'],
        scope: 'BRANCH',
      });
      const profile = await owner.doctorProfile.create({
        data: { tenantId: h.tenant, userId: p.id, code: kit.uniq(`DOC_${key}_`) },
      });
      return { token: p.token(branch), profile: profile.id, userId: p.id };
    };
    const dMain = await doctor('dmain', h.main);
    const dEast = await doctor('deast', h.east);
    const noProfile = await kit.person(h, 'noprof', [h.main], {
      permissions: ['opd.doctors.own'],
      scope: 'BRANCH',
    });
    return {
      h,
      admin: cast.admin,
      adminId: cast.adminId,
      branchAdmin: cast.branchAdmin,
      nobody: cast.nobody,
      docMainToken: dMain.token,
      docMainProfile: dMain.profile,
      docMainUserId: dMain.userId,
      docEastToken: dEast.token,
      docEastProfile: dEast.profile,
      noProfileToken: noProfile.token(h.main),
    };
  }

  beforeAll(async () => {
    const booted = await bootApp(clock);
    app = booted.app;
    const kit = createKit(owner, booted.tokens);
    A = await seed('A', kit);
    B = await seed('B', kit);
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  /** Fresh state for every test: no leave, no request (the owner login may only touch leave). */
  beforeEach(async () => {
    clock.set(new Date('2026-11-23T04:30:00Z'));
    for (const c of [A, B]) {
      await owner.doctorLeave.deleteMany({ where: { tenantId: c.h.tenant } });
    }
    // requests cannot be deleted (database trigger): every test uses its own dates, and anything
    // still waiting from an earlier test is closed (cancelled) so the limit of waiting ones is not hit
    for (const c of [A, B]) {
      await owner.doctorLeaveRequest.updateMany({
        where: { tenantId: c.h.tenant, status: 'PENDING' },
        data: { status: 'CANCELLED', decidedBy: c.adminId, decidedAt: new Date() },
      });
    }
  });

  let nextDay = 0;
  /** A period nobody used before in this run (requests are never deleted), 2 days long. */
  function freshPeriod(): { fromDate: string; toDate: string } {
    nextDay += 3;
    const start = new Date(Date.UTC(2027, 0, 1) + nextDay * 86_400_000);
    const end = new Date(start.getTime() + 86_400_000);
    return { fromDate: start.toISOString().slice(0, 10), toDate: end.toISOString().slice(0, 10) };
  }

  async function ask(token: string, period = freshPeriod()) {
    const res = await http().post(mineUrl).set(auth(token)).send(period).expect(201);
    return { id: res.body.id as string, period };
  }

  // ------------------------------------------------------------------ permissions

  it('denies by default: no role, no request, no list, no decision', async () => {
    const { id } = await ask(A.docMainToken);
    await http().post(mineUrl).set(auth(A.nobody)).send(freshPeriod()).expect(403);
    await http().get(mineUrl).set(auth(A.nobody)).expect(403);
    await http().post(`${mineUrl}/${id}/cancel`).set(auth(A.nobody)).expect(403);
    await http().get('/opd/leave-requests').set(auth(A.nobody)).expect(403);
    await http().post(`/opd/leave-requests/${id}/approve`).set(auth(A.nobody)).expect(403);
    await http().post(`/opd/leave-requests/${id}/reject`).set(auth(A.nobody)).expect(403);
    await http().get('/opd/leave-requests').expect(401);
  });

  it('a doctor cannot use the Admin routes, an Admin without a doctor profile cannot ask', async () => {
    const { id } = await ask(A.docMainToken);
    await http().get('/opd/leave-requests').set(auth(A.docMainToken)).expect(403);
    await http().post(`/opd/leave-requests/${id}/approve`).set(auth(A.docMainToken)).expect(403);
    await http().post(mineUrl).set(auth(A.noProfileToken)).send(freshPeriod()).expect(403);
    const res = await http().get(mineUrl).set(auth(A.noProfileToken)).expect(403);
    expect(res.body.code).toBe('DOCTOR_PROFILE_REQUIRED');
  });

  // ------------------------------------------------------------------ doctor side

  it('a doctor asks, sees it waiting, and it blocks nothing until approved', async () => {
    const { id, period } = await ask(A.docMainToken);
    const mine = await http().get(mineUrl).set(auth(A.docMainToken)).expect(200);
    const row = mine.body.items.find((r: { id: string }) => r.id === id);
    expect(row).toMatchObject({ ...period, status: 'PENDING', decidedAt: null });
    expect(mine.body.today).toBe('2026-11-23');
    expect(await owner.doctorLeave.count({ where: { doctorProfileId: A.docMainProfile } })).toBe(0);
    // a doctor sees only their own requests
    const other = await http().get(mineUrl).set(auth(A.docEastToken)).expect(200);
    expect(other.body.items.some((r: { id: string }) => r.id === id)).toBe(false);
  });

  it('the menu number: how many requests wait, only for people who may decide, only their hospital', async () => {
    const before = await http()
      .get('/opd/leave-requests/pending-count')
      .set(auth(A.admin))
      .expect(200);
    await ask(A.docMainToken);
    const after = await http()
      .get('/opd/leave-requests/pending-count')
      .set(auth(A.admin))
      .expect(200);
    expect(after.body.count).toBe(before.body.count + 1);
    // another hospital's Admin does not count it; doctors, nobody and no token cannot ask
    const other = await http()
      .get('/opd/leave-requests/pending-count')
      .set(auth(B.admin))
      .expect(200);
    expect(other.body.count).toBe(0);
    await http().get('/opd/leave-requests/pending-count').set(auth(A.docMainToken)).expect(403);
    await http().get('/opd/leave-requests/pending-count').set(auth(A.nobody)).expect(403);
    await http().get('/opd/leave-requests/pending-count').expect(401);
  });

  it('the doctor comes from the token: the body cannot name another doctor or hospital', async () => {
    const period = freshPeriod();
    const res = await http()
      .post(mineUrl)
      .set(auth(A.docMainToken))
      .send({ ...period, doctorProfileId: A.docEastProfile })
      .expect(400);
    expect(res.body.code).toBe('AVAILABILITY_INVALID');
    const ok = await ask(A.docMainToken);
    const row = await owner.doctorLeaveRequest.findUniqueOrThrow({ where: { id: ok.id } });
    expect(row.doctorProfileId).toBe(A.docMainProfile);
    expect(row.requestedBy).toBe(A.docMainUserId);
  });

  it('refuses bad dates with the availability words', async () => {
    const reason = async (body: unknown) => {
      const res = await http().post(mineUrl).set(auth(A.docMainToken)).send(body).expect(400);
      expect(res.body.code).toBe('AVAILABILITY_INVALID');
      return res.body.reason as string;
    };
    expect(await reason({})).toBe('DATE_INVALID');
    expect(await reason({ fromDate: '2027-02-30', toDate: '2027-03-01' })).toBe('DATE_INVALID');
    expect(await reason({ fromDate: '2027-03-05', toDate: '2027-03-01' })).toBe('END_BEFORE_START');
    expect(await reason({ fromDate: '2026-11-01', toDate: '2026-11-02' })).toBe('DATE_IN_PAST');
    expect(await reason({ fromDate: '2027-01-01', toDate: '2028-03-01' })).toBe('TOO_LONG');
    expect(await reason({ fromDate: '2027-03-01', toDate: '2027-03-02', reason: 'holiday' })).toBe(
      'UNKNOWN_FIELD',
    );
  });

  it('refuses a period that overlaps existing leave or another waiting request', async () => {
    const first = await ask(A.docMainToken);
    const res = await http().post(mineUrl).set(auth(A.docMainToken)).send(first.period).expect(400);
    expect(res.body.reason).toBe('LEAVE_OVERLAP');
    await owner.doctorLeave.create({
      data: {
        tenantId: A.h.tenant,
        doctorProfileId: A.docEastProfile,
        fromDate: new Date('2027-06-10T00:00:00Z'),
        toDate: new Date('2027-06-12T00:00:00Z'),
      },
    });
    const over = await http()
      .post(mineUrl)
      .set(auth(A.docEastToken))
      .send({ fromDate: '2027-06-12', toDate: '2027-06-14' })
      .expect(400);
    expect(over.body.reason).toBe('LEAVE_OVERLAP');
  });

  it('limits the requests waiting at the same time', async () => {
    // docEast starts with none waiting from this test; earlier tests leave at most a few
    const waiting = await owner.doctorLeaveRequest.count({
      where: { doctorProfileId: A.docEastProfile, status: 'PENDING' },
    });
    for (let i = waiting; i < 5; i += 1) {
      await ask(A.docEastToken);
    }
    const res = await http()
      .post(mineUrl)
      .set(auth(A.docEastToken))
      .send(freshPeriod())
      .expect(409);
    expect(res.body.code).toBe('LEAVE_REQUEST_CONFLICT');
    expect(res.body.reason).toBe('TOO_MANY_PENDING');
  });

  it('a doctor cancels a waiting request once; not another doctor, not a decided one', async () => {
    const { id } = await ask(A.docMainToken);
    // another doctor cannot even see it
    await http().post(`${mineUrl}/${id}/cancel`).set(auth(A.docEastToken)).expect(404);
    const done = await http().post(`${mineUrl}/${id}/cancel`).set(auth(A.docMainToken)).expect(200);
    expect(done.body.status).toBe('CANCELLED');
    const again = await http()
      .post(`${mineUrl}/${id}/cancel`)
      .set(auth(A.docMainToken))
      .expect(409);
    expect(again.body.reason).toBe('ALREADY_DECIDED');
    // a cancelled request can no longer be approved or rejected
    const late = await http()
      .post(`/opd/leave-requests/${id}/approve`)
      .set(auth(A.admin))
      .expect(409);
    expect(late.body.reason).toBe('ALREADY_DECIDED');
  });

  it('an approved leave cannot be cancelled by the doctor', async () => {
    const { id } = await ask(A.docMainToken);
    await http().post(`/opd/leave-requests/${id}/approve`).set(auth(A.admin)).expect(200);
    const res = await http().post(`${mineUrl}/${id}/cancel`).set(auth(A.docMainToken)).expect(409);
    expect(res.body.reason).toBe('ALREADY_DECIDED');
    expect(await owner.doctorLeave.count({ where: { doctorProfileId: A.docMainProfile } })).toBe(1);
  });

  it('a bad id is a 400, an unknown id a 404', async () => {
    await http().post(`${mineUrl}/not%20an%20id/cancel`).set(auth(A.docMainToken)).expect(400);
    await http()
      .post(`${mineUrl}/cmissing000000000000000000/cancel`)
      .set(auth(A.docMainToken))
      .expect(404);
    await http()
      .post('/opd/leave-requests/cmissing000000000000000000/approve')
      .set(auth(A.admin))
      .expect(404);
  });

  // ------------------------------------------------------------------ admin side

  it('approval creates the leave through the availability rules and audits ids and dates only', async () => {
    const { id, period } = await ask(A.docMainToken);
    const res = await http()
      .post(`/opd/leave-requests/${id}/approve`)
      .set(auth(A.admin))
      .expect(200);
    expect(res.body).toMatchObject({ id, status: 'APPROVED', ...period });
    expect(res.body.doctor.id).toBe(A.docMainProfile);
    expect(res.body.decidedByName).toBe('Person sa');
    const leave = await owner.doctorLeave.findMany({
      where: { doctorProfileId: A.docMainProfile },
    });
    expect(leave).toHaveLength(1);
    expect(leave[0].fromDate.toISOString().slice(0, 10)).toBe(period.fromDate);
    const stored = await owner.doctorLeaveRequest.findUniqueOrThrow({ where: { id } });
    expect(stored.leaveId).toBe(leave[0].id);
    expect(stored.decidedBy).toBe(A.adminId);
    const logs = await owner.auditLog.findMany({
      where: { entityType: 'doctor_leave_requests', entityId: id },
    });
    expect(logs.map((l) => (l.metadata as { kind: string }).kind).sort()).toEqual([
      'APPROVE',
      'REQUEST',
    ]);
    // only ids and dates: no names, no free text
    const keys = new Set(logs.flatMap((l) => Object.keys(l.metadata as object)));
    expect([...keys].sort()).toEqual(['doctorProfileId', 'fromDate', 'kind', 'leaveId', 'toDate']);
    const leaveLog = await owner.auditLog.findFirstOrThrow({
      where: { entityType: 'doctor_profiles', entityId: A.docMainProfile },
      orderBy: { createdAt: 'desc' },
    });
    expect((leaveLog.metadata as { requestId?: string }).requestId).toBe(id);
  });

  it('approval is refused (request stays waiting) when the days now overlap other leave', async () => {
    const { id, period } = await ask(A.docMainToken);
    await owner.doctorLeave.create({
      data: {
        tenantId: A.h.tenant,
        doctorProfileId: A.docMainProfile,
        fromDate: new Date(`${period.fromDate}T00:00:00Z`),
        toDate: new Date(`${period.toDate}T00:00:00Z`),
      },
    });
    await http().post(`/opd/leave-requests/${id}/approve`).set(auth(A.admin)).expect(400);
    expect((await owner.doctorLeaveRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
      'PENDING',
    );
    // the Admin can still reject it
    await http().post(`/opd/leave-requests/${id}/reject`).set(auth(A.admin)).expect(200);
  });

  it('approval is refused when the leave is already over by approval day', async () => {
    const { id } = await ask(A.docMainToken);
    clock.set(new Date('2028-06-01T04:30:00Z'));
    const res = await http()
      .post(`/opd/leave-requests/${id}/approve`)
      .set(auth(A.admin))
      .expect(409);
    expect(res.body.reason).toBe('DATE_IN_PAST');
    expect(await owner.doctorLeave.count({ where: { doctorProfileId: A.docMainProfile } })).toBe(0);
  });

  it('reject changes nothing else and cannot be repeated or reversed', async () => {
    const { id } = await ask(A.docMainToken);
    const res = await http()
      .post(`/opd/leave-requests/${id}/reject`)
      .set(auth(A.admin))
      .expect(200);
    expect(res.body.status).toBe('REJECTED');
    expect(await owner.doctorLeave.count({ where: { doctorProfileId: A.docMainProfile } })).toBe(0);
    expect(
      (await http().post(`/opd/leave-requests/${id}/reject`).set(auth(A.admin)).expect(409)).body
        .reason,
    ).toBe('ALREADY_DECIDED');
    expect(
      (await http().post(`/opd/leave-requests/${id}/approve`).set(auth(A.admin)).expect(409)).body
        .reason,
    ).toBe('ALREADY_DECIDED');
  });

  it('two decisions at the same moment: exactly one wins, one leave only', async () => {
    const { id } = await ask(A.docMainToken);
    const calls = await Promise.all([
      http().post(`/opd/leave-requests/${id}/approve`).set(auth(A.admin)),
      http().post(`/opd/leave-requests/${id}/approve`).set(auth(A.admin)),
      http().post(`/opd/leave-requests/${id}/reject`).set(auth(A.admin)),
    ]);
    const statuses = calls.map((c) => c.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    const final = await owner.doctorLeaveRequest.findUniqueOrThrow({ where: { id } });
    const leaves = await owner.doctorLeave.count({ where: { doctorProfileId: A.docMainProfile } });
    expect(leaves).toBe(final.status === 'APPROVED' ? 1 : 0);
  });

  it('nobody decides their own request', async () => {
    // an Admin who is also a doctor
    const kitAdminDoctor = await owner.doctorProfile.create({
      data: { tenantId: A.h.tenant, userId: A.adminId, code: `SELF_${Date.now()}` },
    });
    const period = freshPeriod();
    const made = await http().post(mineUrl).set(auth(A.admin)).send(period);
    // the SuperAdmin role may hold opd.doctors.own; if not, the route is closed to them anyway
    if (made.status === 201) {
      const res = await http()
        .post(`/opd/leave-requests/${made.body.id}/approve`)
        .set(auth(A.admin))
        .expect(403);
      expect(res.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
      await http()
        .post(`/opd/leave-requests/${made.body.id}/reject`)
        .set(auth(A.admin))
        .expect(403);
      expect(await owner.doctorLeave.count({ where: { doctorProfileId: kitAdminDoctor.id } })).toBe(
        0,
      );
    } else {
      expect(made.status).toBe(403);
    }
  });

  it('scope: SuperAdmin sees every doctor, a Branch Admin only doctors of their own branch', async () => {
    const main = await ask(A.docMainToken);
    const east = await ask(A.docEastToken);
    const ids = async (token: string) =>
      (
        (
          await http()
            .get('/opd/leave-requests?status=ALL&pageSize=100')
            .set(auth(token))
            .expect(200)
        ).body.items as { id: string }[]
      ).map((r) => r.id);
    const sa = await ids(A.admin);
    expect(sa).toEqual(expect.arrayContaining([main.id, east.id]));
    const ba = await ids(A.branchAdmin);
    expect(ba).toContain(main.id);
    expect(ba).not.toContain(east.id);
    // and cannot decide a doctor of another branch (looks like it does not exist)
    await http()
      .post(`/opd/leave-requests/${east.id}/approve`)
      .set(auth(A.branchAdmin))
      .expect(404);
    await http().post(`/opd/leave-requests/${east.id}/reject`).set(auth(A.branchAdmin)).expect(404);
    expect(
      (await owner.doctorLeaveRequest.findUniqueOrThrow({ where: { id: east.id } })).status,
    ).toBe('PENDING');
    // the Branch Admin can decide their own branch
    await http()
      .post(`/opd/leave-requests/${main.id}/approve`)
      .set(auth(A.branchAdmin))
      .expect(200);
  });

  it('known behaviour: a waiting request follows the doctor, so after a move to another branch only that branch and a hospital-wide Admin can decide it', async () => {
    const waiting = await ask(A.docMainToken);
    const listed = async (token: string) =>
      (
        (
          await http()
            .get('/opd/leave-requests?status=ALL&pageSize=100')
            .set(auth(token))
            .expect(200)
        ).body.items as { id: string }[]
      ).map((r) => r.id);
    const where = (branchId: string) => ({
      tenantId_userId_branchId: { tenantId: A.h.tenant, userId: A.docMainUserId, branchId },
    });
    // before the move: the Branch Admin of MAIN sees it
    expect(await listed(A.branchAdmin)).toContain(waiting.id);

    // the doctor moves from MAIN to EAST (the request itself is not touched)
    await owner.userBranch.update({ where: where(A.h.main), data: { isActive: false } });
    await owner.userBranch.upsert({
      where: where(A.h.east),
      create: { tenantId: A.h.tenant, userId: A.docMainUserId, branchId: A.h.east },
      update: { isActive: true },
    });
    try {
      // MAIN's Branch Admin no longer sees it and cannot decide it (looks like it does not exist)
      expect(await listed(A.branchAdmin)).not.toContain(waiting.id);
      await http()
        .post(`/opd/leave-requests/${waiting.id}/approve`)
        .set(auth(A.branchAdmin))
        .expect(404);
      await http()
        .post(`/opd/leave-requests/${waiting.id}/reject`)
        .set(auth(A.branchAdmin))
        .expect(404);
      expect(
        (await owner.doctorLeaveRequest.findUniqueOrThrow({ where: { id: waiting.id } })).status,
      ).toBe('PENDING');
      // the hospital-wide Admin still sees and decides it
      expect(await listed(A.admin)).toContain(waiting.id);
      await http().post(`/opd/leave-requests/${waiting.id}/approve`).set(auth(A.admin)).expect(200);
      expect(
        (await owner.doctorLeaveRequest.findUniqueOrThrow({ where: { id: waiting.id } })).status,
      ).toBe('APPROVED');
    } finally {
      await owner.userBranch.update({ where: where(A.h.east), data: { isActive: false } });
      await owner.userBranch.update({ where: where(A.h.main), data: { isActive: true } });
    }
  });

  it('list: default is waiting only, count, filter, paging and bad status', async () => {
    const one = await ask(A.docMainToken);
    const two = await ask(A.docMainToken);
    await http().post(`/opd/leave-requests/${two.id}/reject`).set(auth(A.admin)).expect(200);
    const waiting = await http().get('/opd/leave-requests').set(auth(A.admin)).expect(200);
    const waitingIds = waiting.body.items.map((r: { id: string }) => r.id);
    expect(waitingIds).toContain(one.id);
    expect(waitingIds).not.toContain(two.id);
    expect(waiting.body.pendingCount).toBeGreaterThanOrEqual(1);
    expect(waiting.body.pendingCount).toBe(waiting.body.total);
    const rejected = await http()
      .get('/opd/leave-requests?status=REJECTED')
      .set(auth(A.admin))
      .expect(200);
    expect(rejected.body.items.every((r: { status: string }) => r.status === 'REJECTED')).toBe(
      true,
    );
    const paged = await http()
      .get('/opd/leave-requests?status=ALL&pageSize=1&page=2')
      .set(auth(A.admin))
      .expect(200);
    expect(paged.body.items).toHaveLength(1);
    expect(paged.body.pageSize).toBe(1);
    const bad = await http().get('/opd/leave-requests?status=NOPE').set(auth(A.admin)).expect(400);
    expect(bad.body.reason).toBe('STATUS_INVALID');
  });

  // ------------------------------------------------------------------ tenant isolation

  it('another hospital sees and decides nothing of this one, and the reverse', async () => {
    const a = await ask(A.docMainToken);
    const b = await ask(B.docMainToken);
    const bList = (
      await http().get('/opd/leave-requests?status=ALL&pageSize=100').set(auth(B.admin)).expect(200)
    ).body.items.map((r: { id: string }) => r.id);
    expect(bList).toContain(b.id);
    expect(bList).not.toContain(a.id);
    await http().post(`/opd/leave-requests/${a.id}/approve`).set(auth(B.admin)).expect(404);
    await http().post(`/opd/leave-requests/${a.id}/reject`).set(auth(B.admin)).expect(404);
    await http().post(`${mineUrl}/${a.id}/cancel`).set(auth(B.docMainToken)).expect(404);
    expect((await owner.doctorLeaveRequest.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'PENDING',
    );
  });

  // ------------------------------------------------------------------ database guards

  it('the database refuses delete, truncate, editing a closed request and a wrong-hospital doctor', async () => {
    const { id } = await ask(A.docMainToken);
    await expect(owner.doctorLeaveRequest.delete({ where: { id } })).rejects.toThrow();
    await expect(owner.$executeRawUnsafe('TRUNCATE TABLE doctor_leave_requests')).rejects.toThrow();
    // the days cannot be changed
    await expect(
      owner.doctorLeaveRequest.update({ where: { id }, data: { toDate: new Date('2030-01-01') } }),
    ).rejects.toThrow();
    // a decision without a decider is refused by the check constraint
    await expect(
      owner.doctorLeaveRequest.update({ where: { id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow();
    // close it, then it cannot be re-opened or switched
    await http().post(`/opd/leave-requests/${id}/reject`).set(auth(A.admin)).expect(200);
    await expect(
      owner.doctorLeaveRequest.update({
        where: { id },
        data: { status: 'APPROVED' },
      }),
    ).rejects.toThrow();
    await expect(
      owner.doctorLeaveRequest.update({
        where: { id },
        data: { status: 'PENDING', decidedBy: null, decidedAt: null },
      }),
    ).rejects.toThrow();
    // a doctor of another hospital cannot be attached (composite foreign key)
    await expect(
      owner.doctorLeaveRequest.create({
        data: {
          tenantId: A.h.tenant,
          doctorProfileId: B.docMainProfile,
          fromDate: new Date('2031-01-01'),
          toDate: new Date('2031-01-02'),
          requestedBy: A.adminId,
        },
      }),
    ).rejects.toThrow();
  });
});
