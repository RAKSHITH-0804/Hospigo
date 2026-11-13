/**
 * ONE-TIME SCRIPT — create the first Indigo HQ admin.
 *
 * Usage (from repo root, with DATABASE_URL_HQ set):
 *   npx tsx apps/api/scripts/create-hq-admin.ts admin@example.com
 *
 * Prints a temporary password ONCE to the console.
 * Do NOT paste that password into chat, tickets, or Git.
 * Store only the hash in the database (must_change_password = true).
 */
import 'dotenv/config';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { randomInt } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';

loadEnv({ path: path.resolve(process.cwd(), '.env') });
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

const TEMP_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const TEMP_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const TEMP_DIGIT = '23456789';
const TEMP_SYMBOL = '!@#$%^&*-_=+';
const TEMP_ALL = TEMP_UPPER + TEMP_LOWER + TEMP_DIGIT + TEMP_SYMBOL;
const TEMP_LENGTH = 14;

async function main(): Promise<void> {
  const emailArg = process.argv[2];
  if (!emailArg || !emailArg.includes('@')) {
    console.error('Usage: npx tsx apps/api/scripts/create-hq-admin.ts <email>');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();

  const url = process.env.DATABASE_URL_HQ;
  if (!url) {
    console.error('DATABASE_URL_HQ is required');
    process.exit(1);
  }

  const { PrismaClient } = await import('../src/generated/prisma');
  const adapter = new PrismaPg({ connectionString: url });
  const prisma = new PrismaClient({ adapter });

  try {
    const existing = await prisma.hqUser.findUnique({ where: { email } });
    if (existing) {
      console.error('HQ user with that email already exists');
      process.exit(1);
    }

    const tempPassword = generateTempPassword(TEMP_LENGTH);
    const passwordHash = await argon2.hash(tempPassword, { type: argon2.argon2id });

    await prisma.hqUser.create({
      data: {
        email,
        displayName: email.split('@')[0] || 'HQ Admin',
        passwordHash,
        mustChangePassword: true,
      },
    });

    console.log('HQ admin created.');
    console.log(`email=${email}`);
    console.log(`temporary_password=${tempPassword}`);
    console.log(
      'IMPORTANT: Copy the temporary password now. Do not paste it into chat or commit it to Git.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

function generateTempPassword(length: number): string {
  const chars: string[] = [
    TEMP_UPPER[randomInt(TEMP_UPPER.length)]!,
    TEMP_LOWER[randomInt(TEMP_LOWER.length)]!,
    TEMP_DIGIT[randomInt(TEMP_DIGIT.length)]!,
    TEMP_SYMBOL[randomInt(TEMP_SYMBOL.length)]!,
  ];
  while (chars.length < length) {
    chars.push(TEMP_ALL[randomInt(TEMP_ALL.length)]!);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars.join('');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
