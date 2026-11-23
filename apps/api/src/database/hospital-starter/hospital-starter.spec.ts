import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { createOwnerPrisma, requireTestDatabaseUrl } from '../db-test.util';
import { ensureSystemRolesForTenant } from '../../../prisma/seeds/reference';
import {
  StarterError,
  defaultStarterOptions,
  runHospitalStarter,
  type StarterOptions,
} from './hospital-starter';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('hospital starter script (hospigo_test only)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(120_000);

  const owner = createOwnerPrisma();
  const stamp = Date.now();
  let n = 0;
  const unique = (p: string) => `${p}${stamp}${(n += 1)}`;

  afterAll(async () => {
    await owner.$disconnect();
  });

  /** A hospital as the runbook describes it: hospital, main branch, roles, a SuperAdmin user. */
  async function emptyHospital(
    o: { superAdmin?: boolean; mainBranch?: boolean } = {},
  ): Promise<{ code: string; tenantId: string; adminId: string | null }> {
    const code = unique('STR_');
    const hospital = await owner.hospital.create({
      data: { code, name: `Starter ${code}`, status: 'ACTIVE', isTest: true },
    });
    const { superAdminRoleId } = await ensureSystemRolesForTenant(owner, hospital.id);
    if (o.mainBranch !== false) {
      await owner.branch.create({
        data: {
          tenantId: hospital.id,
          code: 'MAIN',
          name: 'Main',
          isMain: true,
          accessCode: unique('acc-'),
        },
      });
    }
    let adminId: string | null = null;
    if (o.superAdmin !== false) {
      const user = await owner.user.create({
        data: {
          tenantId: hospital.id,
          code: 'SA1',
          email: `${unique('sa')}@example.test`,
          displayName: 'First SuperAdmin',
          passwordHash: 'x',
        },
      });
      await owner.roleAssignment.create({
        data: {
          tenantId: hospital.id,
          userId: user.id,
          roleId: superAdminRoleId,
          scopeType: 'HOSPITAL',
        },
      });
      adminId = user.id;
    }
    return { code, tenantId: hospital.id, adminId };
  }

  async function counts(tenantId: string) {
    const where = { tenantId };
    return {
      paymentModes: await owner.paymentMode.count({ where }),
      vitals: await owner.vitalsField.count({ where }),
      series: await owner.numberSeriesSettings.count({ where }),
      settings: await owner.opdSettings.count({ where }),
      chargeItems: await owner.chargeItem.count({ where }),
      prices: await owner.chargeItemPrice.count({ where }),
      fees: await owner.doctorFee.count({ where }),
      fieldSettings: await owner.patientFieldSetting.count({ where }),
      uhid: await owner.uhidFormatConfig.count({ where }),
      patients: await owner.patient.count({ where }),
      doctors: await owner.doctorProfile.count({ where }),
      visits: await owner.opdVisit.count({ where }),
      users: await owner.user.count({ where }),
    };
  }

  const options = (code: string, change: Partial<StarterOptions> = {}): StarterOptions => ({
    ...defaultStarterOptions(code),
    ...change,
  });

  it('refuses an unknown hospital and creates nothing', async () => {
    await expect(runHospitalStarter(owner, options('NO_SUCH_HOSPITAL'))).rejects.toThrow(
      /No active hospital/,
    );
    await expect(runHospitalStarter(owner, options('bad code!'))).rejects.toThrow(StarterError);
  });

  it('stops with a plain message when the hospital is not ready (no main branch, no SuperAdmin)', async () => {
    const noBranch = await emptyHospital({ mainBranch: false });
    await expect(runHospitalStarter(owner, options(noBranch.code))).rejects.toThrow(/main branch/);
    const noAdmin = await emptyHospital({ superAdmin: false });
    await expect(runHospitalStarter(owner, options(noAdmin.code))).rejects.toThrow(/SuperAdmin/);
    for (const h of [noBranch, noAdmin]) {
      const c = await counts(h.tenantId);
      expect(c.paymentModes + c.vitals + c.series + c.settings + c.chargeItems + c.uhid).toBe(0);
    }
  });

  it('dry run prints what it would do and changes nothing', async () => {
    const h = await emptyHospital();
    const before = await counts(h.tenantId);
    const report = await runHospitalStarter(owner, options(h.code, { dryRun: true }));
    expect(report.dryRun).toBe(true);
    expect(report.created).toEqual(
      expect.arrayContaining([
        'Payment mode CASH',
        'Vitals field pulse',
        'Number series BILL',
        'OPD rules',
        'Registration charge item (no price yet)',
        'Patient number (UHID) format',
      ]),
    );
    expect(await counts(h.tenantId)).toEqual(before);
    expect(await owner.auditLog.count({ where: { tenantId: h.tenantId } })).toBe(0);
  });

  it('creates the standard data and NO demo data (no patients, doctors, users, visits or prices)', async () => {
    const h = await emptyHospital();
    const report = await runHospitalStarter(owner, options(h.code));
    expect(report.dryRun).toBe(false);
    const c = await counts(h.tenantId);
    const catalog = await owner.patientFieldCatalog.count();
    expect(c).toMatchObject({
      paymentModes: 3,
      vitals: 7,
      series: 3,
      settings: 1,
      chargeItems: 1,
      fieldSettings: catalog,
      uhid: 1,
      // nothing else:
      prices: 0,
      fees: 0,
      patients: 0,
      doctors: 0,
      visits: 0,
      users: 1, // only the SuperAdmin that had to exist before
    });
    const modes = await owner.paymentMode.findMany({ where: { tenantId: h.tenantId } });
    expect(Object.fromEntries(modes.map((m) => [m.code, m.requiresReference]))).toEqual({
      CASH: false,
      UPI: true,
      CARD: true,
    });
    const item = await owner.chargeItem.findFirstOrThrow({ where: { tenantId: h.tenantId } });
    expect(item.kind).toBe('REGISTRATION');
    const rules = await owner.opdSettings.findUniqueOrThrow({ where: { tenantId: h.tenantId } });
    expect(rules).toMatchObject({
      followUpFreeDays: 7,
      repeatVisitFreeHours: 0,
      tokenPrefix: 'T',
      timezone: 'Asia/Kolkata',
      taxEnabled: false,
    });
    const audit = await owner.auditLog.findFirstOrThrow({
      where: { tenantId: h.tenantId, action: 'hospital.starter.run' },
    });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/[0-9]{4}\/[0-9]{5}/);
  });

  it('is safe to run twice: no duplicates, and a value an Admin changed is never overwritten', async () => {
    const h = await emptyHospital();
    await runHospitalStarter(owner, options(h.code));
    const before = await counts(h.tenantId);

    // an Admin changes things
    await owner.paymentMode.update({
      where: { tenantId_code: { tenantId: h.tenantId, code: 'CASH' } },
      data: { name: 'Cash desk' },
    });
    await owner.vitalsField.update({
      where: { tenantId_code: { tenantId: h.tenantId, code: 'pulse' } },
      data: { warnMax: 140, active: false },
    });
    await owner.opdSettings.update({
      where: { tenantId: h.tenantId },
      data: { followUpFreeDays: 14, repeatVisitFreeHours: 24 },
    });
    await owner.patientFieldSetting.updateMany({
      where: { tenantId: h.tenantId, isRequired: false },
      data: { isEnabled: false },
    });

    const second = await runHospitalStarter(owner, options(h.code, { width: 9, fyStyle: 'LONG' }));
    expect(second.created).toEqual([]);
    expect(await counts(h.tenantId)).toEqual(before);
    expect(
      (
        await owner.paymentMode.findUniqueOrThrow({
          where: { tenantId_code: { tenantId: h.tenantId, code: 'CASH' } },
        })
      ).name,
    ).toBe('Cash desk');
    const pulse = await owner.vitalsField.findUniqueOrThrow({
      where: { tenantId_code: { tenantId: h.tenantId, code: 'pulse' } },
    });
    expect(pulse.warnMax?.toString()).toBe('140');
    expect(pulse.active).toBe(false);
    const rules = await owner.opdSettings.findUniqueOrThrow({ where: { tenantId: h.tenantId } });
    expect(rules.followUpFreeDays).toBe(14);
    expect(rules.repeatVisitFreeHours).toBe(24);
    expect(
      await owner.patientFieldSetting.count({ where: { tenantId: h.tenantId, isEnabled: false } }),
    ).toBeGreaterThan(0);
    // the series keep the format they were first created with (the second run used other parameters)
    const bill = await owner.numberSeriesSettings.findUniqueOrThrow({
      where: { tenantId_series: { tenantId: h.tenantId, series: 'BILL' } },
    });
    expect(JSON.stringify(bill.format)).toContain('"width":5');
  });

  it('only creates what is missing (a partly set up hospital is completed, not duplicated)', async () => {
    const h = await emptyHospital();
    await owner.paymentMode.create({
      data: { tenantId: h.tenantId, code: 'CASH', name: 'My cash', requiresReference: false },
    });
    const report = await runHospitalStarter(owner, options(h.code));
    expect(report.kept).toContain('Payment mode CASH');
    expect(report.created).toContain('Payment mode UPI');
    expect(await owner.paymentMode.count({ where: { tenantId: h.tenantId } })).toBe(3);
  });

  it('another hospital is never touched', async () => {
    const a = await emptyHospital();
    const b = await emptyHospital();
    await runHospitalStarter(owner, options(a.code));
    const c = await counts(b.tenantId);
    expect(c.paymentModes + c.vitals + c.series + c.settings + c.chargeItems + c.uhid).toBe(0);
  });

  it('takes the number series format and reset rule as parameters (for example 2627/00001 or B-2627-00001)', async () => {
    const h = await emptyHospital();
    await runHospitalStarter(
      owner,
      options(h.code, {
        fyStyle: 'SHORT',
        separator: '-',
        width: 6,
        resetRule: 'NEVER',
        fyStartMonth: 1,
        seriesPrefix: { BILL: 'B-' },
        uhid: { prefix: 'HSP', width: 6, resetRule: 'NEVER' },
      }),
    );
    const bill = await owner.numberSeriesSettings.findUniqueOrThrow({
      where: { tenantId_series: { tenantId: h.tenantId, series: 'BILL' } },
    });
    expect(bill.format).toEqual([
      { type: 'FIXED', text: 'B-' },
      { type: 'FINANCIAL_YEAR', style: 'SHORT' },
      { type: 'SEPARATOR', text: '-' },
      { type: 'RUNNING', width: 6 },
    ]);
    expect(bill.resetRule).toBe('NEVER');
    expect(bill.fyStartMonth).toBe(1);
    const receipt = await owner.numberSeriesSettings.findUniqueOrThrow({
      where: { tenantId_series: { tenantId: h.tenantId, series: 'RECEIPT' } },
    });
    expect(receipt.format).toEqual([
      { type: 'FINANCIAL_YEAR', style: 'SHORT' },
      { type: 'SEPARATOR', text: '-' },
      { type: 'RUNNING', width: 6 },
    ]);
    const uhid = await owner.uhidFormatConfig.findFirstOrThrow({
      where: { tenantId: h.tenantId },
      include: { blocks: { orderBy: { position: 'asc' } } },
    });
    expect(uhid.resetRule).toBe('NEVER');
    expect(uhid.blocks.map((b) => b.blockType)).toEqual(['FIXED_TEXT', 'RUNNING_NUMBER']);
  });

  it('refuses bad parameters before touching the database', async () => {
    const h = await emptyHospital();
    const bad: Array<Partial<StarterOptions>> = [
      { width: 0 },
      { width: 13 },
      { width: 2.5 },
      { separator: 'abcd' },
      { separator: 'a\nb' },
      { fyStartMonth: 13 },
      { fyStyle: 'MEDIUM' as 'SHORT' },
      { resetRule: 'MONTHLY' as 'NEVER' },
      { seriesPrefix: { BILL: 'x'.repeat(13) } },
      { uhid: { prefix: '', width: 0, resetRule: 'NEVER' } },
    ];
    for (const change of bad) {
      await expect(runHospitalStarter(owner, options(h.code, change))).rejects.toThrow(
        StarterError,
      );
    }
    expect((await counts(h.tenantId)).paymentModes).toBe(0);
  });

  it('warns about a branch without a real access code and about OPD switched off', async () => {
    const h = await emptyHospital();
    await owner.branch.create({
      data: {
        tenantId: h.tenantId,
        code: 'EAST',
        name: 'East',
        isMain: false,
        accessCode: `dev-placeholder-${unique('x')}`,
      },
    });
    const report = await runHospitalStarter(owner, options(h.code, { dryRun: true }));
    expect(report.warnings.join(' ')).toMatch(/Branch EAST has no real access code/);
    expect(report.warnings.join(' ')).toMatch(/OPD module is not switched on/);
  });
});
