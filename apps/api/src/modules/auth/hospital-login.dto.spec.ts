import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HospitalLoginDto } from './dto/hospital-login.dto';

/** Every email produced by apps/api/prisma/seeds/dev-tenants.ts (hyphenated domains). */
const SEEDED_EMAILS = [
  'superadmin@demo-north.example.test',
  'branchadmin@demo-north.example.test',
  'staff@demo-north.example.test',
  'mustchange@demo-north.example.test',
  'superadmin@demo-south.example.test',
  'branchadmin@demo-south.example.test',
  'staff@demo-south.example.test',
  'mustchange@demo-south.example.test',
] as const;

describe('HospitalLoginDto email validation for seed accounts', () => {
  it('accepts every seeded hospital email (hyphenated domains)', async () => {
    for (const email of SEEDED_EMAILS) {
      const dto = plainToInstance(HospitalLoginDto, {
        accessCode: 'demo-north-main',
        email,
        password: 'placeholder-not-checked',
      });
      const errors = await validate(dto);
      expect(errors).toEqual([]);
    }
  });

  it('rejects underscore domain that class-validator IsEmail does not allow', async () => {
    const dto = plainToInstance(HospitalLoginDto, {
      accessCode: 'demo-north-main',
      email: 'staff@demo_north.example.test',
      password: 'placeholder-not-checked',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'email')).toBe(true);
  });
});
