/**
 * Maps API module codes to hospital-shell nav entries.
 * Labels/routes live here — never hardcode hospital-specific module lists in components.
 */

export type ModuleNavConfig = {
  label: string;
  href: string;
  /** Optional icon key for future use (not rendered yet). */
  icon: string;
};

/** Catalog of known clinical modules. Dashboard is always added separately. */
export const MODULE_NAV_BY_CODE: Record<string, ModuleNavConfig> = {
  OPD: { label: 'OPD queue', href: '/app/opd', icon: 'opd' },
  IPD: { label: 'IPD wards', href: '/app/ipd', icon: 'ipd' },
  PHARMACY: { label: 'Pharmacy', href: '/app/pharmacy', icon: 'pharmacy' },
  LAB: { label: 'Lab and radiology', href: '/app/lab', icon: 'lab' },
  RADIOLOGY: { label: 'Lab and radiology', href: '/app/lab', icon: 'lab' },
  ONLINE_BOOKING: { label: 'Online booking', href: '/app/billing', icon: 'booking' },
};

export type EnabledModuleRef = { code: string; name: string };

export type ShellNavItem = { href: string; label: string };

/**
 * Build sidebar items: Dashboard first, then enabled modules present in the mapping.
 * Unknown codes are skipped (no hardcoding of a full hospital menu).
 */
export function shellNavFromEnabledModules(modules: EnabledModuleRef[]): ShellNavItem[] {
  const items: ShellNavItem[] = [{ href: '/app', label: 'Dashboard' }];
  const seenHrefs = new Set<string>(['/app']);
  for (const mod of modules) {
    const cfg = MODULE_NAV_BY_CODE[mod.code];
    if (!cfg) {
      continue;
    }
    if (seenHrefs.has(cfg.href)) {
      continue;
    }
    seenHrefs.add(cfg.href);
    items.push({ href: cfg.href, label: cfg.label });
  }
  return items;
}

/** Resolve module code for a staff app path (e.g. /app/opd → OPD). */
export function moduleCodeForAppPath(pathname: string): string | null {
  const normalized = pathname.replace(/\/$/, '') || '/app';
  if (normalized === '/app') {
    return null;
  }
  for (const [code, cfg] of Object.entries(MODULE_NAV_BY_CODE)) {
    if (normalized === cfg.href || normalized.startsWith(`${cfg.href}/`)) {
      return code;
    }
  }
  return null;
}
