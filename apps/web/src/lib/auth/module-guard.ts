import { redirect } from 'next/navigation';
import { sessionConfig } from '@/config/session';
import { MODULE_NAV_BY_CODE } from '@/config/modules';
import { requireKind } from './guards';
import type { SessionResult } from './session';

/**
 * Ensures the signed-in hospital session has the module enabled for the active branch.
 * Dashboard (/app) has no module code and is always allowed via requireKind alone.
 */
export async function requireModule(moduleCode: string): Promise<SessionResult> {
  const session = await requireKind('HOSPITAL');
  const enabled = session.enabledModules?.some((m) => m.code === moduleCode) ?? false;
  if (!enabled) {
    redirect(`${sessionConfig.homeHospital}?notice=module-unavailable`);
  }
  return session;
}

export function isModuleMapped(moduleCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODULE_NAV_BY_CODE, moduleCode);
}
