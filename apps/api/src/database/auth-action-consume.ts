import type { Prisma } from '../generated/prisma';
import type { HqPrismaService } from './hq-prisma.service';
import type { TenantTx } from './tenant-db';

/**
 * Atomic single-use consume for hospital action tokens.
 * Call inside TenantDb.withTenant so RLS and password update share one transaction.
 * Uses updateMany count === 1 so concurrent consumers cannot both succeed.
 */
export async function consumeHospitalActionTokenRow(
  tx: TenantTx,
  input: { tenantId: string; tokenId: string },
): Promise<{ id: string; userId: string } | null> {
  const updated = await tx.authActionToken.updateMany({
    where: {
      id: input.tokenId,
      tenantId: input.tenantId,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (updated.count !== 1) {
    return null;
  }
  const row = await tx.authActionToken.findFirst({
    where: { id: input.tokenId },
    select: { id: true, userId: true },
  });
  return row ? { id: row.id, userId: row.userId } : null;
}

/**
 * HQ interactive transaction door (safety-net forbids $transaction outside database/).
 */
export async function runHqTransaction<T>(
  hqPrisma: HqPrismaService,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return hqPrisma.$transaction(fn);
}

/**
 * Atomic single-use consume for HQ password-reset tokens.
 */
export async function consumeHqActionTokenRow(
  tx: Prisma.TransactionClient,
  tokenId: string,
): Promise<{ id: string; hqUserId: string } | null> {
  const updated = await tx.hqAuthActionToken.updateMany({
    where: {
      id: tokenId,
      purpose: 'PASSWORD_RESET',
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (updated.count !== 1) {
    return null;
  }
  const row = await tx.hqAuthActionToken.findFirst({
    where: { id: tokenId },
    select: { id: true, hqUserId: true },
  });
  return row ? { id: row.id, hqUserId: row.hqUserId } : null;
}
