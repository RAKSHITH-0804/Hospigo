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

/**
 * The branches a person may switch between (Step 2.1b): every active branch for a hospital-wide
 * person, otherwise the active branches they hold through an active role assignment AND an active
 * branch membership. A person with fewer than two branches is not a switcher. Re-read from the
 * database on every call, never from the token. Must run inside TenantDb.withTenant.
 */
export async function switchableBranchIds(
  tx: TenantTx,
  userId: string,
): Promise<{ all: true } | { all: false; ids: string[] }> {
  if (await userHasHospitalScope(tx, userId)) {
    return { all: true };
  }
  const assigned = await tx.roleAssignmentBranch.findMany({
    where: {
      isActive: true,
      branch: { isActive: true },
      assignment: { userId, isActive: true, role: { isActive: true } },
    },
    select: { branchId: true },
  });
  const ids = [...new Set(assigned.map((row) => row.branchId))];
  if (ids.length === 0) {
    return { all: false, ids: [] };
  }
  const member = await tx.userBranch.findMany({
    where: { userId, isActive: true, branchId: { in: ids } },
    select: { branchId: true },
  });
  return { all: false, ids: [...new Set(member.map((row) => row.branchId))] };
}

/** true when the person has a switcher (hospital-wide, or two or more branches of their own). */
export async function canSwitchBranches(tx: TenantTx, userId: string): Promise<boolean> {
  const scope = await switchableBranchIds(tx, userId);
  return scope.all || scope.ids.length >= 2;
}
