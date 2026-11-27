import type { INestApplication } from '@nestjs/common';
import argon2 from 'argon2';
import request from 'supertest';
import type { PrismaClient } from '../../generated/prisma';
import {
  SAMPLE_VALUE_LABELS,
  sampleTemplates,
} from '../../modules/print-templates/sample-templates';
import { logoPng } from './png-logo';
import type { ShowcaseHospital } from './showcase-data';

/** What the library step needs to know about a hospital that was just set up. */
export type LibrarySetup = {
  hospital: ShowcaseHospital;
  tenantId: string;
  mainBranchId: string;
  superAdmin: { id: string };
};

export type Library = { templateIds: Map<string, string>; logoIds: Map<string, string> };

/**
 * The designed sample templates and the logos go into the Indigo library and are assigned to both
 * showcase hospitals; the header and footer lines of the printouts are stored as print values.
 * Safe to run again (everything is looked up first).
 */
export async function seedLibrary(prisma: PrismaClient, setups: LibrarySetup[]): Promise<Library> {
  const templateIds = new Map<string, string>();
  const logoIds = new Map<string, string>();
  for (const sample of sampleTemplates()) {
    const input = sample.input as unknown as object;
    const row = await prisma.printLibraryTemplate.upsert({
      where: { key: sample.key },
      create: {
        docType: sample.docType,
        key: sample.key,
        name: sample.name,
        description: sample.description,
        input,
      },
      update: { input, name: sample.name, retiredAt: null },
    });
    templateIds.set(sample.key, row.id);
  }
  for (const setup of setups) {
    const mark = setup.hospital.logo;
    const png = logoPng(256, mark.colour, mark.variant);
    const logo = await prisma.printLibraryLogo.upsert({
      where: { name: mark.name },
      create: {
        name: mark.name,
        contentType: 'image/png',
        byteSize: png.length,
        width: 256,
        height: 256,
        data: new Uint8Array(png),
      },
      update: {},
    });
    logoIds.set(setup.tenantId, logo.id);
    const wanted: Array<{ templateId: string | null; logoId: string | null }> = [
      ...[...templateIds.values()].map((templateId) => ({ templateId, logoId: null })),
      { templateId: null, logoId: logo.id },
    ];
    for (const item of wanted) {
      const exists = await prisma.printLibraryAssignment.findFirst({
        where: { tenantId: setup.tenantId, ...item },
      });
      if (!exists) {
        await prisma.printLibraryAssignment.create({ data: { tenantId: setup.tenantId, ...item } });
      }
    }
    for (const [key, value] of Object.entries(setup.hospital.contact)) {
      const found = await prisma.printValue.findFirst({
        where: { tenantId: setup.tenantId, branchId: null, key },
      });
      if (found) {
        await prisma.printValue.update({ where: { id: found.id }, data: { value, active: true } });
      } else {
        await prisma.printValue.create({
          data: {
            tenantId: setup.tenantId,
            branchId: null,
            key,
            label: SAMPLE_VALUE_LABELS[key] ?? key,
            value,
            createdBy: setup.superAdmin.id,
            updatedBy: setup.superAdmin.id,
          },
        });
      }
    }
  }
  return { templateIds, logoIds };
}

const DESIGNS = [
  ['slip-classic', 'bill-classic', 'rx-classic', 'report-classic', 'card-classic'],
  ['slip-modern', 'bill-modern', 'rx-modern', 'report-modern', 'card-band'],
];

/** The SuperAdmin of each hospital chooses a design for every document and the logo, through the real routes. */
export async function chooseDesigns(
  app: INestApplication,
  tokens: {
    signHospitalAccess: (c: { tenantId: string; userId: string; branchId: string }) => string;
  },
  setups: LibrarySetup[],
  library: Library,
): Promise<void> {
  for (const [index, setup] of setups.entries()) {
    const token = tokens.signHospitalAccess({
      tenantId: setup.tenantId,
      userId: setup.superAdmin.id,
      branchId: setup.mainBranchId,
    });
    const put = async (path: string): Promise<void> => {
      const res = await request(app.getHttpServer())
        .put(path)
        .set('Authorization', 'Bearer ' + token);
      if (res.status !== 200) {
        throw new Error(
          'Choosing ' + path + ' failed: ' + res.status + ' ' + res.text.slice(0, 200),
        );
      }
    };
    for (const key of DESIGNS[index % DESIGNS.length]!) {
      const id = library.templateIds.get(key);
      if (id) {
        await put('/print-library/templates/' + id + '/choose');
      }
    }
    const logoId = library.logoIds.get(setup.tenantId);
    if (logoId) {
      await put('/print-library/logos/' + logoId + '/choose');
    }
  }
}

/**
 * The HQ demo people: the HQ Admin (every hospital) and HQ Staff assigned
 * to both showcase hospitals. The password is the name SEED_INDIGO_PASSWORD (else the staff password) in .env.
 */
export async function seedShowcaseIndigo(
  prisma: PrismaClient,
  setups: LibrarySetup[],
): Promise<void> {
  const password = process.env.SEED_INDIGO_PASSWORD || process.env.SEED_STAFF_PASSWORD;
  if (!password) {
    console.log('No SEED_INDIGO_PASSWORD or SEED_STAFF_PASSWORD: no HQ demo people.');
    return;
  }
  const passwordHash = await argon2.hash(password);
  for (const person of [
    { email: 'hq.admin@indigo.example.org', displayName: 'HQ Admin', indigoRole: 'OWNER' },
    {
      email: 'hq.staff@indigo.example.org',
      displayName: 'HQ Staff',
      indigoRole: 'EMPLOYEE',
    },
  ]) {
    const row = await prisma.hqUser.upsert({
      where: { email: person.email },
      create: { ...person, passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      update: { ...person, passwordHash, mustChangePassword: false, isActive: true },
    });
    if (person.indigoRole === 'EMPLOYEE') {
      for (const setup of setups) {
        await prisma.hqUserHospital.upsert({
          where: { hqUserId_tenantId: { hqUserId: row.id, tenantId: setup.tenantId } },
          create: { hqUserId: row.id, tenantId: setup.tenantId },
          update: {},
        });
      }
    }
  }
}
