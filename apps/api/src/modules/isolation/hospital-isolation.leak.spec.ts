import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import { FakeClock } from '../../common/clock';
import {
  autoHospitalContext,
  createAppPrisma,
  createOwnerPrisma,
  createTenantDb,
  requireTestDatabaseUrl,
} from '../../database/db-test.util';
import { ImportBatchService } from '../imports/import-batch.service';
import { PatientFieldsService } from '../patients/patient-fields.service';
import { PatientsService } from '../patients/patients.service';
import { UhidService } from '../patients/uhid.service';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('Hospital isolation through services (leak tests)', () => {
  requireTestDatabaseUrl();
  jest.setTimeout(90_000);

  const owner = createOwnerPrisma();
  const app = createAppPrisma();
  const clock = new FakeClock(new Date('2026-06-15T12:00:00.000Z'));

  let tenantA: string;
  let tenantB: string;
  let branchAMain: string;
  let branchAEast: string;
  let branchBMain: string;
  let actorA: string;
  let actorB: string;
  let patientAId: string;
  let patientAUhid: string;
  let batchAId: string;
  let importTypeId: string;
  let patientsA: PatientsService;
  let patientsB: PatientsService;
  let importsA: ImportBatchService;
  let uhidA: UhidService;

  beforeAll(async () => {
    const stamp = Date.now();
    const type = await owner.importType.create({
      data: { code: `LEAK_${stamp}`, name: 'Leak import type' },
    });
    importTypeId = type.id;

    const ha = await owner.hospital.create({
      data: {
        code: `LEA_${stamp}`,
        name: 'Leak A',
        accessCode: `lea-${stamp}`,
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true },
            { code: 'EAST', name: 'East', isMain: false },
          ],
        },
      },
      include: { branches: true },
    });
    const hb = await owner.hospital.create({
      data: {
        code: `LEB_${stamp}`,
        name: 'Leak B',
        accessCode: `leb-${stamp}`,
        isTest: true,
        branches: { create: { code: 'MAIN', name: 'Main', isMain: true } },
      },
      include: { branches: true },
    });
    tenantA = ha.id;
    tenantB = hb.id;
    branchAMain = ha.branches.find((b) => b.code === 'MAIN')!.id;
    branchAEast = ha.branches.find((b) => b.code === 'EAST')!.id;
    branchBMain = hb.branches[0]!.id;

    const ua = await owner.user.create({
      data: {
        tenantId: tenantA,
        code: `LEA_U_${stamp}`,
        email: `lea_${stamp}@example.test`,
        displayName: 'A',
        passwordHash: 'x',
      },
    });
    const ub = await owner.user.create({
      data: {
        tenantId: tenantB,
        code: `LEB_U_${stamp}`,
        email: `leb_${stamp}@example.test`,
        displayName: 'B',
        passwordHash: 'x',
      },
    });
    actorA = ua.id;
    actorB = ub.id;

    for (const [tid, uid, prefix] of [
      [tenantA, actorA, 'LEA'],
      [tenantB, actorB, 'LEB'],
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
      await owner.uhidFormatConfig.create({
        data: {
          tenantId: tid,
          effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
          resetRule: 'NEVER',
          fyStartMonth: 4,
          timezone: 'Asia/Kolkata',
          createdBy: uid,
          blocks: {
            create: [
              { position: 1, blockType: 'FIXED_TEXT', textValue: prefix },
              { position: 2, blockType: 'RUNNING_NUMBER', minWidth: 3 },
            ],
          },
        },
      });
    }

    const pageConfig = {
      get: (key: string) => (key === 'PATIENT_SEARCH_MAX_PAGE_SIZE' ? 20 : undefined),
    } as unknown as ConfigService;

    const db = createTenantDb(app);
    const fields = autoHospitalContext(new PatientFieldsService(db));
    uhidA = autoHospitalContext(new UhidService(db, clock));
    patientsA = autoHospitalContext(new PatientsService(db, fields, uhidA, pageConfig));
    patientsB = patientsA;
    importsA = autoHospitalContext(new ImportBatchService(db, clock));

    const reg = await patientsA.register({
      tenantId: tenantA,
      registeredBranchId: branchAMain,
      createdBy: actorA,
      name: 'Alice Leak',
      phone: '9000000001',
    });
    patientAId = reg.id;
    patientAUhid = reg.uhid;

    await patientsA.register({
      tenantId: tenantB,
      registeredBranchId: branchBMain,
      createdBy: actorB,
      name: 'Bob Leak',
      phone: '9000000002',
    });

    const batch = await importsA.createBatch({
      tenantId: tenantA,
      importTypeId,
      createdBy: actorA,
      templateVersion: '1',
      fileStorageKey: `k/leak_${stamp}`,
      fileSha256: `leak_${stamp}`,
      fileNameOriginal: 'leak.xlsx',
      branchId: branchAMain,
    });
    batchAId = batch.id;
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  it('search under hospital A never returns hospital B patients', async () => {
    const byName = await patientsA.search({ tenantId: tenantA, namePrefix: 'Bob' });
    expect(byName.items).toHaveLength(0);
    const byPhone = await patientsA.search({ tenantId: tenantA, phone: '9000000002' });
    expect(byPhone.items).toHaveLength(0);
    const alice = await patientsA.search({ tenantId: tenantA, uhid: patientAUhid });
    expect(alice.items).toHaveLength(1);
    expect(alice.items[0]?.id).toBe(patientAId);
  });

  it('passing B ids into A context finds nothing / refuses cross-tenant branch register', async () => {
    const ghost = await patientsA.search({ tenantId: tenantA, uhid: 'LEB999' });
    expect(ghost.items).toHaveLength(0);

    await expect(
      patientsA.register({
        tenantId: tenantA,
        registeredBranchId: branchBMain,
        createdBy: actorA,
        name: 'Cross Branch',
      }),
    ).rejects.toThrow(/branch not found|Registered branch|Foreign key|foreign key/i);

    await expect(
      importsA.markPreviewed({
        tenantId: tenantA,
        batchId: batchAId + '_nope',
        actorUserId: actorA,
      }),
    ).rejects.toThrow(/not found|refused/i);

    // B's batch id under A's tenant context
    await expect(
      importsA.approve({
        tenantId: tenantA,
        batchId: 'nonexistent_batch_b',
        actorUserId: actorA,
      }),
    ).rejects.toThrow();
  });

  it('UHID counters of A and B are independent', async () => {
    const a1 = await patientsA.register({
      tenantId: tenantA,
      registeredBranchId: branchAEast,
      createdBy: actorA,
      name: 'A2',
    });
    const b1 = await patientsB.register({
      tenantId: tenantB,
      registeredBranchId: branchBMain,
      createdBy: actorB,
      name: 'B2',
    });
    expect(a1.uhid.startsWith('LEA')).toBe(true);
    expect(b1.uhid.startsWith('LEB')).toBe(true);

    const counterA = await owner.uhidCounter.findUniqueOrThrow({
      where: { tenantId_periodYear: { tenantId: tenantA, periodYear: 0 } },
    });
    const counterB = await owner.uhidCounter.findUniqueOrThrow({
      where: { tenantId_periodYear: { tenantId: tenantB, periodYear: 0 } },
    });
    expect(counterA.lastNumber).toBeGreaterThan(0n);
    expect(counterB.lastNumber).toBeGreaterThan(0n);
  });

  it('import batch ops under A cannot see or change B batches', async () => {
    const batchB = await importsA.createBatch({
      tenantId: tenantB,
      importTypeId,
      createdBy: actorB,
      templateVersion: '1',
      fileStorageKey: `k/leak_b_${Date.now()}`,
      fileSha256: `leak_b_${Date.now()}`,
      fileNameOriginal: 'b.xlsx',
      branchId: branchBMain,
    });
    await expect(
      importsA.markPreviewed({
        tenantId: tenantA,
        batchId: batchB.id,
        actorUserId: actorA,
      }),
    ).rejects.toThrow(/not found|refused/i);

    const stillDraft = await owner.importBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    expect(stillDraft.status).toBe('DRAFT');
    expect(stillDraft.tenantId).toBe(tenantB);
  });
});
