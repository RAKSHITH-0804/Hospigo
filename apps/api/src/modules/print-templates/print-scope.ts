import { AccessService } from '../access/access.service';
import { opdError, OpdErrorCode } from '../opd-visits/opd-visit.errors';
import type { Actor } from '../opd-visits/opd-visits.service';

/** Where a print template or print value is saved: the signed-in branch only, or the whole hospital. */
export type PrintScope = 'branch' | 'hospital';

/**
 * Hospital-wide changes need the settings permission in EVERY branch (a SuperAdmin, or the Admin of a
 * hospital that has one branch); a branch change needs it in the signed-in branch only. The branch
 * comes from the token. Anything else is a 403 (deny by default).
 */
export async function assertMayChangePrint(
  access: AccessService,
  actor: Actor,
  scope: PrintScope,
  /** The permission that allows the change: templates use print.templates.manage (Indigo Owner only, Step 2.1b). */
  code = 'opd.settings.write',
): Promise<void> {
  if (scope === 'hospital') {
    if ((await access.hospitalWideBranches(code, 'OPD')).length === 0) {
      throw opdError(403, OpdErrorCode.PRINT_SCOPE_FORBIDDEN);
    }
    return;
  }
  if (!(await access.can(code, actor.branchId, 'OPD'))) {
    throw opdError(403, OpdErrorCode.PRINT_SCOPE_FORBIDDEN);
  }
}
