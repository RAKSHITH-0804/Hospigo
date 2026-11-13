import 'dotenv/config';
import path from 'path';
import { config as loadEnv } from 'dotenv';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { BranchAccessLookup } from '../../database/branch-access.lookup';
import { createAppPrisma, createOwnerPrisma, createTenantDb } from '../../database/db-test.util';
import { PrismaService } from '../../database/prisma.service';
import { loadAuthConfig } from './auth.config';
import { HospitalLoginHelper } from './hospital-login.helper';
import { MembershipHelper } from './membership.helper';
import { PasswordService } from './password.service';

loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
loadEnv({ path: path.resolve(process.cwd(), '.env') });

const HOSPITAL = 'hospital-access-secret-value-32chars!!';
const HQ = 'hq-access-secret-value-32-characters!!!';

describe('HospitalLoginHelper membership', () => {
  const owner = createOwnerPrisma();
  const app = createAppPrisma();
  let accessCodeMain: string;
  let accessCodeEast: string;
  let email: string;
  let password: string;

  beforeAll(async () => {
    const stamp = Date.now();
    accessCodeMain = `hl-main-${stamp}`;
    accessCodeEast = `hl-east-${stamp}`;
    email = `hl_${stamp}@example.test`;
    password = 'CorrectHorse9!';
    const hash = await argon2.hash(password);

    const hospital = await owner.hospital.create({
      data: {
        code: `HL_${stamp}`,
        name: 'Login Helper Hospital',
        isTest: true,
        branches: {
          create: [
            { code: 'MAIN', name: 'Main', isMain: true, accessCode: accessCodeMain },
            { code: 'EAST', name: 'East', isMain: false, accessCode: accessCodeEast },
          ],
        },
      },
      include: { branches: true },
    });
    const main = hospital.branches.find((b) => b.code === 'MAIN')!;
    const user = await owner.user.create({
      data: {
        tenantId: hospital.id,
        code: 'HL1',
        email,
        displayName: 'Login User',
        passwordHash: hash,
        mustChangePassword: false,
      },
    });
    await owner.userBranch.create({
      data: {
        tenantId: hospital.id,
        userId: user.id,
        branchId: main.id,
      },
    });
  });

  afterAll(async () => {
    await owner.$disconnect();
    await app.$disconnect();
  });

  function helper(): HospitalLoginHelper {
    const auth = loadAuthConfig({
      JWT_HOSPITAL_ACCESS_SECRET: HOSPITAL,
      JWT_HQ_ACCESS_SECRET: HQ,
      JWT_PATIENT_ACCESS_SECRET: 'patient-access-secret-value-32chars!!',
      OTP_HASH_SECRET: 'otp-hash-secret-value-min-32-characters!',
    });
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'auth') return auth;
        throw new Error(key);
      },
    } as unknown as ConfigService;
    const prisma = app as unknown as PrismaService;
    const tenantDb = createTenantDb(app);
    return new HospitalLoginHelper(
      new BranchAccessLookup(prisma),
      tenantDb,
      new MembershipHelper(tenantDb),
      new PasswordService(config),
    );
  }

  it('resolves via assigned branch code and fails identically for unassigned branch', async () => {
    const login = helper();
    const ok = await login.attempt({
      accessCode: accessCodeMain,
      email,
      password,
    });
    expect(ok.ok).toBe(true);

    const denied = await login.attempt({
      accessCode: accessCodeEast,
      email,
      password,
    });
    expect(denied).toMatchObject({ ok: false, reason: 'AUTH_FAILED' });
    expect(denied.ok).toBe(false);
    if (!denied.ok) {
      expect(denied.tenantId).toBeDefined();
      expect(denied.branchId).toBeDefined();
    }

    const unknown = await login.attempt({
      accessCode: 'no-such-code',
      email,
      password,
    });
    expect(unknown).toEqual({ ok: false, reason: 'AUTH_FAILED' });
  });
});
