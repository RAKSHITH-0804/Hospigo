/**
 * ONE-TIME DEV TOOLING — enqueue an activation email for a hospital user.
 *
 * Usage (from repo root):
 *   npm run send-activation -w @hospigo/api -- <accessCode> <email>
 *
 * Requires API env (DATABASE_*, REDIS_URL, SMTP_*, APP_URL). Never logs tokens.
 */
import 'dotenv/config';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';

loadEnv({ path: path.resolve(process.cwd(), '.env') });
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });

async function main(): Promise<void> {
  const accessCode = process.argv[2];
  const emailArg = process.argv[3];
  if (!accessCode || !emailArg || !emailArg.includes('@')) {
    console.error('Usage: npm run send-activation -w @hospigo/api -- <accessCode> <email>');
    process.exit(1);
  }
  const email = emailArg.trim().toLowerCase();

  const { AppModule } = await import('../src/app.module');
  const { BranchAccessLookup } = await import('../src/database/branch-access.lookup');
  const { TenantDb } = await import('../src/database/tenant-db');
  const { runWithContext } = await import('../src/common/request-context');
  const { AuthEmailService } = await import('../src/modules/auth/auth-email.service');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const lookup = app.get(BranchAccessLookup);
    const tenantDb = app.get(TenantDb);
    const authEmail = app.get(AuthEmailService);

    const branch = await lookup.findByAccessCode(accessCode);
    if (!branch) {
      console.error('Access code not found or inactive');
      process.exit(1);
    }

    const user = await runWithContext(
      {
        tenantId: branch.tenantId,
        userId: null,
        kind: 'HOSPITAL',
        activeBranchId: branch.branchId,
        requestId: randomUUID(),
      },
      async () =>
        tenantDb.withTenant((tx) =>
          tx.user.findFirst({
            where: { email: { equals: email, mode: 'insensitive' }, isActive: true },
            select: { id: true },
          }),
        ),
    );
    if (!user) {
      console.error('User not found or inactive for that hospital');
      process.exit(1);
    }

    await authEmail.sendActivation(branch.tenantId, user.id);
    console.log('Activation email job enqueued.');
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
