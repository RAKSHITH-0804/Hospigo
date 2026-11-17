import type { TenantTx } from '../../database/tenant-db';

/**
 * True when the user holds an active role assignment with HOSPITAL scope on an
 * active role. This is the single definition of "hospital-wide" used by:
 * - the branch switcher (who may switch), and
 * - refreshHospital (a session on a branch the user has no membership in is
 *   still valid for a hospital-wide user; same rule as AccessService).
 *
 * Must run inside TenantDb.withTenant (RLS limits rows to the caller's hospital).
 */
export async function userHasHospitalScope(tx: TenantTx, userId: string): Promise<boolean> {
  const row = await tx.roleAssignment.findFirst({
    where: {
      userId,
      isActive: true,
      scopeType: 'HOSPITAL',
      role: { isActive: true },
    },
    select: { id: true },
  });
  return row !== null;
}
