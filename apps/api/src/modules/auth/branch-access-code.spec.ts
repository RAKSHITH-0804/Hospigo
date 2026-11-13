import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { createOwnerPrisma, createPgClient } from '../../database/db-test.util';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

describe('branch access_code uniqueness', () => {
  const prisma = createOwnerPrisma();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('enforces case-insensitive unique access codes and drops hospitals.access_code', async () => {
    const stamp = Date.now();
    await prisma.hospital.create({
      data: {
        code: `BAC_${stamp}`,
        name: 'Branch Access Code Hospital',
        isTest: true,
        branches: {
          create: {
            code: 'MAIN',
            name: 'Main',
            isMain: true,
            accessCode: `BaC-${stamp}`,
          },
        },
      },
    });

    await expect(
      prisma.hospital.create({
        data: {
          code: `BAC2_${stamp}`,
          name: 'Other',
          isTest: true,
          branches: {
            create: {
              code: 'MAIN',
              name: 'Main',
              isMain: true,
              accessCode: `bac-${stamp}`,
            },
          },
        },
      }),
    ).rejects.toThrow();

    const client = createPgClient('owner');
    await client.connect();
    try {
      const col = await client.query(
        `
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'hospitals'
          AND column_name = 'access_code'
        `,
      );
      expect(col.rowCount).toBe(0);
    } finally {
      await client.end();
    }
  });
});
