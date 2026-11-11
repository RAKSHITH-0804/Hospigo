import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { FakeClock } from '../../common/clock';
import {
  asHospital,
  autoHospitalContext,
  createAppPrisma,
  createOwnerPrisma,
  createTenantDb,
  requireTestDatabaseUrl,
} from '../../database/db-test.util';
import { PatientFieldsService } from './patient-fields.service';
import { PatientsService } from './patients.service';
import { UhidService } from './uhid.service';
import { buildUhid, resolvePeriodYear } from './uhid.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('Patients + UHID engine (hospigo_test only)', () => {
  requireTestDatabaseUrl();
  const owner = createOwnerPrisma();
  const app = createAppPrisma();
  const clock = new FakeClock(new Date('2026-06-15T12:00:00.000Z'));
  let tenantId: string;
  let tenantOther: string;
  let branchMain: string;
  let branchEast: string;
  let actorId: string;
  let patients: PatientsService;
  let fields: PatientFieldsService;
  let uhid: UhidService;

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
    for (const key of [
      'gender',
      'date_of_birth',
      'phone',
      'email',
      'address_street',
      'address_cross',
      'address_area',
      'address_city',
      'address_state',
      'address_pincode',
    ]) {
      await owner.patientFieldCatalog.upsert({
        where: { key },
        create: {
          key,
          defaultLabel: key,
          dataType: key === 'date_of_birth' ? 'DATE' : 'TEXT',
          canDisable: true,
          alwaysRequired: false,
        },
        update: {},
      });
    }

    const hospital = await owner.hospital.create({
      data: {
        code: `P3B_${stamp}`,
        name: 'Patient Test Hospital',
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: `p3b-${stamp}` },
            { code: 'EAST', name: 'East', isMain: false, accessCode: `p3b-${stamp}-east` },
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
        code: `P3B_O_${stamp}`,
        name: 'Other Hospital',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `p3bo-${stamp}` },
        },
      },
      include: { branches: true },
    });
    tenantOther = other.id;

    const actor = await owner.user.create({
      data: {
        tenantId,
        code: `ACT_${stamp}`,
        email: `act_${stamp}@example.test`,
        displayName: 'Actor',
        passwordHash: 'x',
      },
    });
    actorId = actor.id;

    const actorOther = await owner.user.create({
      data: {
        tenantId: tenantOther,
        code: `ACTO_${stamp}`,
        email: `acto_${stamp}@example.test`,
        displayName: 'Actor Other',
        passwordHash: 'x',
      },
    });

    for (const [tid, uid] of [
      [tenantId, actorId],
      [tenantOther, actorOther.id],
    ] as const) {
      const catalog = await owner.patientFieldCatalog.findMany();
      let order = 0;
      for (const c of catalog) {
        await owner.patientFieldSetting.create({
          data: {
            tenantId: tid,
            catalogKey: c.key,
            isEnabled: true,
            isRequired: c.alwaysRequired,
            label: c.defaultLabel,
            sortOrder: order++,
            changedBy: uid,
          },
        });
      }
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
            { position: 1, blockType: 'FIXED_TEXT', textValue: 'TESTA' },
            { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 4 },
          ],
        },
      },
    });
    await owner.uhidFormatConfig.create({
      data: {
        tenantId: tenantOther,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        resetRule: 'NEVER',
        fyStartMonth: 4,
        timezone: 'Asia/Kolkata',
        createdBy: actorOther.id,
        blocks: {
          create: [
            { position: 1, blockType: 'FIXED_TEXT', textValue: 'TESTA' },
            { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 4 },
          ],
        },
      },
    });

    const config = {
      get: (key: string) => (key === 'PATIENT_SEARCH_MAX_PAGE_SIZE' ? 10 : undefined),
      getOrThrow: () => {
        throw new Error('unexpected');
      },
    } as unknown as ConfigService;

    const tenantDb = createTenantDb(app);
    uhid = autoHospitalContext(new UhidService(tenantDb, clock));
    fields = autoHospitalContext(new PatientFieldsService(tenantDb));
    patients = autoHospitalContext(new PatientsService(tenantDb, fields, uhid, config as never));
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('renders NEVER and FINANCIAL_YEAR example formats without truncating padding', () => {
    const neverUhid = buildUhid({
      config: {
        resetRule: 'NEVER',
        fyStartMonth: 4,
        timezone: 'Asia/Kolkata',
        blocks: [
          {
            position: 1,
            blockType: 'FIXED_TEXT',
            textValue: 'TESTA',
            fyStyle: null,
            minWidth: null,
          },
          {
            position: 2,
            blockType: 'RUNNING_NUMBER',
            textValue: null,
            fyStyle: null,
            minWidth: 4,
          },
        ],
      },
      now: new Date(),
      periodYear: 0,
      runningNumber: 1n,
      branchCode: 'MAIN',
    });
    expect(neverUhid).toBe('TESTA0001');
    expect(
      buildUhid({
        config: {
          resetRule: 'NEVER',
          fyStartMonth: 4,
          timezone: 'Asia/Kolkata',
          blocks: [
            {
              position: 1,
              blockType: 'FIXED_TEXT',
              textValue: 'TESTA',
              fyStyle: null,
              minWidth: null,
            },
            {
              position: 2,
              blockType: 'RUNNING_NUMBER',
              textValue: null,
              fyStyle: null,
              minWidth: 4,
            },
          ],
        },
        now: new Date(),
        periodYear: 0,
        runningNumber: 12345n,
        branchCode: 'MAIN',
      }),
    ).toBe('TESTA12345');

    const fy = buildUhid({
      config: {
        resetRule: 'FINANCIAL_YEAR',
        fyStartMonth: 4,
        timezone: 'Asia/Kolkata',
        blocks: [
          {
            position: 1,
            blockType: 'FINANCIAL_YEAR',
            textValue: null,
            fyStyle: 'SHORT',
            minWidth: null,
          },
          { position: 2, blockType: 'SEPARATOR', textValue: '/', fyStyle: null, minWidth: null },
          {
            position: 3,
            blockType: 'RUNNING_NUMBER',
            textValue: null,
            fyStyle: null,
            minWidth: 5,
          },
        ],
      },
      now: new Date('2026-06-01T00:00:00+05:30'),
      periodYear: 2026,
      runningNumber: 1n,
      branchCode: 'MAIN',
    });
    expect(fy).toBe('2627/00001');
  });

  it('50 concurrent registrations across two branches yield 50 distinct consecutive numbers', async () => {
    const jobs = Array.from({ length: 50 }, (_, i) =>
      patients.register({
        tenantId,
        registeredBranchId: i % 2 === 0 ? branchMain : branchEast,
        createdBy: actorId,
        name: `Concurrent ${i}`,
      }),
    );
    const results = await Promise.all(jobs);
    const uhids = results.map((r) => r.uhid).sort();
    expect(new Set(uhids).size).toBe(50);
    const numbers = uhids.map((u) => Number(u.replace('TESTA', '')));
    numbers.sort((a, b) => a - b);
    expect(numbers[0]).toBe(1);
    expect(numbers[49]).toBe(50);
  });

  it('rolled-back registration leaves no counter gap', async () => {
    const before = await owner.uhidCounter.findUniqueOrThrow({
      where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
    });
    await expect(
      asHospital(tenantId, () =>
        createTenantDb(app).withTenant(async (tx) => {
          const allocated = await uhid.allocateNextUhid({
            tenantId,
            branchId: branchMain,
            tx,
          });
          await tx.patient.create({
            data: {
              tenantId,
              uhid: allocated.uhid,
              registeredBranchId: branchMain,
              name: '',
              createdBy: actorId,
            },
          });
        }),
      ),
    ).rejects.toThrow();
    const after = await owner.uhidCounter.findUniqueOrThrow({
      where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
    });
    expect(after.lastNumber).toBe(before.lastNumber);
  });

  it('two hospitals can hold the same running number independently', async () => {
    const sharedUhid = `SHARED${Date.now()}`;
    await owner.patient.create({
      data: {
        tenantId,
        uhid: sharedUhid,
        registeredBranchId: branchMain,
        name: 'Hosp A same number',
        createdBy: actorId,
      },
    });
    await owner.patient.create({
      data: {
        tenantId: tenantOther,
        uhid: sharedUhid,
        registeredBranchId: (
          await owner.branch.findFirstOrThrow({ where: { tenantId: tenantOther } })
        ).id,
        name: 'Hosp B same number',
        createdBy: (await owner.user.findFirstOrThrow({ where: { tenantId: tenantOther } })).id,
      },
    });
    const both = await owner.patient.findMany({ where: { uhid: sharedUhid } });
    expect(both).toHaveLength(2);
    expect(new Set(both.map((p) => p.tenantId))).toEqual(new Set([tenantId, tenantOther]));
  });

  it('counter cannot be lowered; collision refuses without advancing', async () => {
    await expect(
      uhid.setStartNumber({
        tenantId,
        periodYear: 0,
        nextNumber: 1n,
        reason: 'try lower',
        actorUserId: actorId,
      }),
    ).rejects.toThrow(/cannot be decreased/i);

    const before = await owner.uhidCounter.findUniqueOrThrow({
      where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
    });
    const next = before.lastNumber + 1n;
    const collide = `TESTA${next.toString().padStart(4, '0')}`;
    await owner.patient.create({
      data: {
        tenantId,
        uhid: collide,
        registeredBranchId: branchMain,
        name: 'Imported Old',
        createdBy: actorId,
      },
    });
    await expect(
      patients.register({
        tenantId,
        registeredBranchId: branchMain,
        createdBy: actorId,
        name: 'Will collide',
      }),
    ).rejects.toThrow(/collision|Unique|refused/i);
    const after = await owner.uhidCounter.findUniqueOrThrow({
      where: { tenantId_periodYear: { tenantId, periodYear: 0 } },
    });
    expect(after.lastNumber).toBe(before.lastNumber);

    // Unblock subsequent registrations on this shared tenant (raise past the imported UHID).
    await uhid.setStartNumber({
      tenantId,
      periodYear: 0,
      nextNumber: next + 1n,
      reason: 'skip imported colliding UHID after collision test',
      actorUserId: actorId,
    });
  });

  it('financial-year rollover with fake clock; NEVER continues', async () => {
    const stamp = Date.now();
    const fyHospital = await owner.hospital.create({
      data: {
        code: `FY_${stamp}`,
        name: 'FY Hospital',
        isTest: true,
        branches: {
          create: { code: 'MAIN', name: 'Main', isMain: true, accessCode: `fy-${stamp}` },
        },
      },
      include: { branches: true },
    });
    const fyUser = await owner.user.create({
      data: {
        tenantId: fyHospital.id,
        code: 'FYU',
        email: `fyu_${stamp}@example.test`,
        displayName: 'FY',
        passwordHash: 'x',
      },
    });
    for (const c of await owner.patientFieldCatalog.findMany()) {
      await owner.patientFieldSetting.create({
        data: {
          tenantId: fyHospital.id,
          catalogKey: c.key,
          isEnabled: true,
          isRequired: c.alwaysRequired,
          label: c.defaultLabel,
          sortOrder: 0,
          changedBy: fyUser.id,
        },
      });
    }
    await owner.uhidFormatConfig.create({
      data: {
        tenantId: fyHospital.id,
        effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
        resetRule: 'FINANCIAL_YEAR',
        fyStartMonth: 4,
        timezone: 'Asia/Kolkata',
        createdBy: fyUser.id,
        blocks: {
          create: [
            { position: 1, blockType: 'FINANCIAL_YEAR', fyStyle: 'SHORT' },
            { position: 2, blockType: 'SEPARATOR', textValue: '/' },
            { position: 3, blockType: 'RUNNING_NUMBER', minWidth: 5 },
          ],
        },
      },
    });

    const fyClock = new FakeClock(new Date('2026-03-31T18:29:00.000Z')); // 31 Mar 23:59 IST
    const fyDb = createTenantDb(app);
    const fyUhid = autoHospitalContext(new UhidService(fyDb, fyClock));
    const fyPatients = autoHospitalContext(
      new PatientsService(fyDb, autoHospitalContext(new PatientFieldsService(fyDb)), fyUhid, {
        get: () => 10,
      } as never),
    );
    const beforeRoll = await fyPatients.register({
      tenantId: fyHospital.id,
      registeredBranchId: fyHospital.branches[0]!.id,
      createdBy: fyUser.id,
      name: 'Before roll',
    });
    expect(beforeRoll.uhid.startsWith('2526/')).toBe(true);

    fyClock.set(new Date('2026-03-31T18:30:00.000Z')); // 1 Apr 00:00 IST
    const afterRoll = await fyPatients.register({
      tenantId: fyHospital.id,
      registeredBranchId: fyHospital.branches[0]!.id,
      createdBy: fyUser.id,
      name: 'After roll',
    });
    expect(afterRoll.uhid).toBe('2627/00001');

    expect(
      resolvePeriodYear(new Date('2026-03-31T18:29:00.000Z'), 'NEVER', 4, 'Asia/Kolkata'),
    ).toBe(0);
  });

  it('format change applies only from effective_from', async () => {
    const stamp = Date.now();
    await uhid.createFormatConfig({
      tenantId,
      createdBy: actorId,
      effectiveFrom: new Date('2099-01-01T00:00:00.000Z'),
      resetRule: 'NEVER',
      blocks: [
        { blockType: 'FIXED_TEXT', textValue: 'NEW', fyStyle: null, minWidth: null },
        { blockType: 'RUNNING_NUMBER', textValue: null, fyStyle: null, minWidth: 4 },
      ],
    });
    clock.set(new Date('2026-06-15T12:00:00.000Z'));
    const reg = await patients.register({
      tenantId,
      registeredBranchId: branchMain,
      createdBy: actorId,
      name: `Still old format ${stamp}`,
    });
    expect(reg.uhid.startsWith('TESTA')).toBe(true);
    expect(reg.uhid.startsWith('NEW')).toBe(false);
  });

  it('FINANCIAL_YEAR reset without FY block is rejected', async () => {
    await expect(
      uhid.createFormatConfig({
        tenantId,
        createdBy: actorId,
        resetRule: 'FINANCIAL_YEAR',
        blocks: [
          { blockType: 'FIXED_TEXT', textValue: 'X', fyStyle: null, minWidth: null },
          { blockType: 'RUNNING_NUMBER', textValue: null, fyStyle: null, minWidth: 3 },
        ],
      }),
    ).rejects.toThrow(/FINANCIAL_YEAR/);
  });

  it('field settings: required/optional/disabled; name cannot be disabled; audit on change', async () => {
    await expect(
      fields.updateSystemFieldSetting({
        tenantId,
        catalogKey: 'name',
        isEnabled: false,
        isRequired: true,
        changedBy: actorId,
      }),
    ).rejects.toThrow(/cannot be disabled/i);

    await fields.updateSystemFieldSetting({
      tenantId,
      catalogKey: 'phone',
      isEnabled: false,
      isRequired: false,
      changedBy: actorId,
    });
    const audits = await owner.auditLog.findMany({
      where: { tenantId, action: 'PATIENT_FIELD_SETTING_CHANGE', entityId: 'phone' },
    });
    expect(audits.length).toBeGreaterThan(0);

    const validated = await fields.validateForRegistration(tenantId, {
      name: 'Has Phone',
      phone: '9999999999',
    });
    expect(validated.ignoredDisabled).toContain('phone');
    expect(validated.cleaned.phone).toBeUndefined();

    await fields.updateSystemFieldSetting({
      tenantId,
      catalogKey: 'gender',
      isEnabled: true,
      isRequired: true,
      changedBy: actorId,
    });
    await expect(fields.validateForRegistration(tenantId, { name: 'No Gender' })).rejects.toThrow(
      /gender/i,
    );

    // Old patient not invalidated when rule tightens
    const old = await owner.patient.create({
      data: {
        tenantId,
        uhid: `OLD${Date.now()}`,
        registeredBranchId: branchMain,
        name: 'Old Patient',
        createdBy: actorId,
      },
    });
    const stillThere = await owner.patient.findUnique({ where: { id: old.id } });
    expect(stillThere?.name).toBe('Old Patient');

    // Restore defaults so later registration tests are not blocked.
    await fields.updateSystemFieldSetting({
      tenantId,
      catalogKey: 'gender',
      isEnabled: true,
      isRequired: false,
      changedBy: actorId,
    });
    await fields.updateSystemFieldSetting({
      tenantId,
      catalogKey: 'phone',
      isEnabled: true,
      isRequired: false,
      changedBy: actorId,
    });
  });

  it('custom field typed values work', async () => {
    const cf = await owner.patientCustomField.create({
      data: {
        tenantId,
        code: `age_note_${Date.now()}`,
        label: 'Age note',
        dataType: 'TEXT',
      },
    });
    await owner.patientFieldSetting.create({
      data: {
        tenantId,
        customFieldId: cf.id,
        isEnabled: true,
        isRequired: false,
        label: 'Age note',
        sortOrder: 99,
        changedBy: actorId,
      },
    });
    const reg = await patients.register({
      tenantId,
      registeredBranchId: branchMain,
      createdBy: actorId,
      name: 'Custom Field Patient',
      customValues: [{ fieldId: cf.id, valueText: 'approx 40' }],
    });
    const values = await owner.patientCustomFieldValue.findMany({
      where: { tenantId, patientId: reg.id },
    });
    expect(values).toHaveLength(1);
    expect(values[0]?.valueText).toBe('approx 40');
  });

  it('patient_identifiers exists, stays empty from services, no search API', async () => {
    const count = await owner.patientIdentifier.count({
      where: { tenantId, identifierType: { not: 'TEST' } },
    });
    expect(count).toBe(0);
    expect((patients as unknown as Record<string, unknown>)['searchByAadhaar']).toBeUndefined();
    expect((patients as unknown as Record<string, unknown>)['saveIdentifier']).toBeUndefined();
  });

  it('search pagination is capped and tenant-scoped', async () => {
    const page = await patients.search({
      tenantId,
      namePrefix: 'C',
      page: 1,
      pageSize: 999,
    });
    expect(page.pageSize).toBeLessThanOrEqual(10);
    for (const item of page.items) {
      const row = await owner.patient.findUniqueOrThrow({ where: { id: item.id } });
      expect(row.tenantId).toBe(tenantId);
    }
  });
});
