import { Injectable } from '@nestjs/common';
import { requireContext } from '../../common/request-context';
import { TenantDb } from '../../database/tenant-db';

type AccessSnapshot = {
  userActive: boolean;
  hospitalActive: boolean;
  /** branchId -> isActive */
  branches: Map<string, boolean>;
  /** permissionCode -> set of branchIds (HOSPITAL scope = all active branch ids) */
  permissionBranches: Map<string, Set<string>>;
  /** branchId -> moduleCode -> { enabledByIndigo, restrictedByHospital, isActive } */
  branchModules: Map<
    string,
    Map<string, { enabledByIndigo: boolean; restrictedByHospital: boolean; isActive: boolean }>
  >;
};

/**
 * Default DENY. Computed once per request via memo on the request context object.
 * Reads only through TenantDb.
 */
@Injectable()
export class AccessService {
  constructor(private readonly tenantDb: TenantDb) {}

  async can(permissionCode: string, branchId: string, moduleCode?: string): Promise<boolean> {
    const snap = await this.loadSnapshot();
    return this.evaluate(snap, permissionCode, branchId, moduleCode);
  }

  async branchesFor(permissionCode: string, moduleCode?: string): Promise<string[]> {
    const snap = await this.loadSnapshot();
    const allowed: string[] = [];
    for (const [branchId, active] of snap.branches) {
      if (!active) {
        continue;
      }
      if (this.evaluate(snap, permissionCode, branchId, moduleCode)) {
        allowed.push(branchId);
      }
    }
    return allowed.sort();
  }

  private evaluate(
    snap: AccessSnapshot,
    permissionCode: string,
    branchId: string,
    moduleCode?: string,
  ): boolean {
    if (!snap.userActive || !snap.hospitalActive) {
      return false;
    }
    const branchActive = snap.branches.get(branchId);
    if (branchActive !== true) {
      return false;
    }

    const ctx = requireContext();
    // activeBranchId only narrows: if set, other branches are denied.
    if (ctx.activeBranchId && ctx.activeBranchId !== branchId) {
      return false;
    }

    const branches = snap.permissionBranches.get(permissionCode);
    if (!branches || !branches.has(branchId)) {
      return false;
    }

    if (moduleCode) {
      const mod = snap.branchModules.get(branchId)?.get(moduleCode);
      if (!mod || !mod.isActive || !mod.enabledByIndigo || mod.restrictedByHospital) {
        return false;
      }
    }

    return true;
  }

  private async loadSnapshot(): Promise<AccessSnapshot> {
    const ctx = requireContext();
    if (!ctx.accessMemo) {
      ctx.accessMemo = new Map();
    }
    const cached = ctx.accessMemo.get('accessSnapshot') as AccessSnapshot | undefined;
    if (cached) {
      return cached;
    }

    if (!ctx.userId || !ctx.tenantId || ctx.kind !== 'HOSPITAL') {
      const empty: AccessSnapshot = {
        userActive: false,
        hospitalActive: false,
        branches: new Map(),
        permissionBranches: new Map(),
        branchModules: new Map(),
      };
      ctx.accessMemo.set('accessSnapshot', empty);
      return empty;
    }

    const userId = ctx.userId;
    const snap = await this.tenantDb.withTenant(async (tx) => {
      const hospital = await tx.hospital.findUnique({ where: { id: ctx.tenantId! } });
      const user = await tx.user.findFirst({
        where: { id: userId, tenantId: ctx.tenantId! },
      });
      const branches = await tx.branch.findMany({
        where: { tenantId: ctx.tenantId! },
        select: { id: true, isActive: true },
      });
      const branchMap = new Map(branches.map((b) => [b.id, b.isActive]));
      const allActiveBranchIds = branches.filter((b) => b.isActive).map((b) => b.id);

      const hospitalActive = !!hospital && hospital.isActive && hospital.status === 'ACTIVE';
      const userActive = !!user && user.isActive;

      const permissionBranches = new Map<string, Set<string>>();

      if (userActive && hospitalActive) {
        const memberships = await tx.userBranch.findMany({
          where: { tenantId: ctx.tenantId!, userId, isActive: true },
          select: { branchId: true },
        });
        const memberBranchIds = new Set(memberships.map((m) => m.branchId));

        const assignments = await tx.roleAssignment.findMany({
          where: {
            tenantId: ctx.tenantId!,
            userId,
            isActive: true,
            role: { isActive: true },
          },
          include: {
            role: {
              include: {
                permissions: {
                  where: { isActive: true, permission: { isActive: true } },
                  include: { permission: true },
                },
              },
            },
            branches: { where: { isActive: true }, select: { branchId: true } },
          },
        });

        for (const assignment of assignments) {
          const codes = assignment.role.permissions.map((rp) => rp.permission.code);
          let covered: string[];
          if (assignment.scopeType === 'HOSPITAL') {
            // HOSPITAL scope covers all active branches; membership not required.
            covered = allActiveBranchIds;
          } else {
            // BRANCH scope: active assignment-branch AND active user_branches membership.
            covered = assignment.branches
              .map((b) => b.branchId)
              .filter((id) => branchMap.get(id) === true && memberBranchIds.has(id));
          }
          for (const code of codes) {
            let set = permissionBranches.get(code);
            if (!set) {
              set = new Set();
              permissionBranches.set(code, set);
            }
            for (const id of covered) {
              set.add(id);
            }
          }
        }
      }

      const branchModules = new Map<
        string,
        Map<string, { enabledByIndigo: boolean; restrictedByHospital: boolean; isActive: boolean }>
      >();
      const moduleRows = await tx.branchModule.findMany({
        where: { tenantId: ctx.tenantId! },
        include: { module: true },
      });
      for (const row of moduleRows) {
        let byBranch = branchModules.get(row.branchId);
        if (!byBranch) {
          byBranch = new Map();
          branchModules.set(row.branchId, byBranch);
        }
        byBranch.set(row.module.code, {
          enabledByIndigo: row.enabledByIndigo,
          restrictedByHospital: row.restrictedByHospital,
          isActive: row.isActive && row.module.isActive,
        });
      }

      return {
        userActive,
        hospitalActive,
        branches: branchMap,
        permissionBranches,
        branchModules,
      } satisfies AccessSnapshot;
    });

    ctx.accessMemo.set('accessSnapshot', snap);
    return snap;
  }
}
