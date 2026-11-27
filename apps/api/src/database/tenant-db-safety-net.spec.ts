import fs from 'node:fs';
import path from 'node:path';

/**
 * SAFETY-NET: scan apps/api/src excluding the database module, seeds, and specs.
 *
 * - set_config and PrismaService: forbidden everywhere scanned — NO allowlist.
 * - $transaction: also hard-forbidden (TenantDb owns transactions).
 * - $queryRaw / $executeRaw: allowlisted by exact path only (must run on a TenantDb tx).
 */
const RAW_SQL_ALLOWLIST = new Map<string, string>([
  [
    'modules/indigo/hq-print.service.ts',
    'HQ reads the Super Admin list through the fixed SECURITY DEFINER function hq_list_superadmins (to find the technical owner for the tenant door), values bound as parameters',
  ],
  [
    'modules/indigo/hq-monitoring.service.ts',
    'HQ monitoring and Super Admin reset call fixed SECURITY DEFINER functions (counts only, list and reset of Super Admins) through the HQ login, values bound as parameters',
  ],
  [
    'modules/indigo/indigo-console.service.ts',
    'Onboarding calls the fixed hq_create_first_superadmin function through the HQ login, values bound as parameters',
  ],
  [
    'modules/patients/uhid.service.ts',
    'UHID counter bump uses $executeRaw/$queryRaw on TenantDb tx',
  ],
  [
    'modules/patients/patients.service.ts',
    'Name-prefix search and duplicate lookup use $queryRaw on TenantDb tx',
  ],
  [
    'modules/numbering/number-series.service.ts',
    'Bill/receipt/refund counter bump uses $executeRaw/$queryRaw on caller tx',
  ],
  [
    'modules/numbering/token-counter.service.ts',
    'Token counter bump uses $executeRaw/$queryRaw on caller tx',
  ],
  [
    'modules/imports/import-batch.service.ts',
    'Batch row lock uses $queryRaw FOR UPDATE on TenantDb tx',
  ],
  [
    'modules/imports/imports.service.ts',
    'Import batch reads and the one-at-a-time lock use $queryRaw on TenantDb tx, tenant filtered, values as parameters',
  ],
  [
    'modules/opd-prices/prices.service.ts',
    'Price list (lateral joins, tenant filtered) and the FOR UPDATE row locks use $queryRaw on TenantDb tx, values as parameters',
  ],
  [
    'modules/opd-clinical/clinical-visit.ts',
    'Visit row lock (SELECT ... FOR UPDATE, filtered by tenant, branch and doctor) on the caller TenantDb tx',
  ],
  [
    'modules/opd-reports/daily-collection.service.ts',
    'Read-only day totals (sums and counts, tenant and branch filtered, values as parameters) on the TenantDb tx, so row level security applies',
  ],
  [
    'modules/patient-auth/patient-auth.service.ts',
    'OTP attempt/consume + request invalidate+insert use $queryRaw/$executeRaw on PatientPrisma (global tables)',
  ],
]);

const HARD_FORBIDDEN = [
  { name: 'PrismaService', re: /\bPrismaService\b/ },
  { name: 'set_config', re: /set_config\s*\(/ },
  { name: '$transaction', re: /\$transaction\s*\(/ },
];

const RAW_SQL_PATTERNS = [
  { name: '$queryRaw', re: /\$queryRaw/ },
  { name: '$executeRaw', re: /\$executeRaw/ },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'generated' || ent.name === 'node_modules' || ent.name === 'database') {
        continue;
      }
      walk(full, out);
    } else if (ent.isFile() && ent.name.endsWith('.ts') && !ent.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('TenantDb safety-net scan', () => {
  it('forbids PrismaService, set_config, and $transaction with no allowlist', () => {
    const srcRoot = path.resolve(__dirname, '..');
    const files = walk(srcRoot);
    const violations: string[] = [];

    for (const abs of files) {
      const rel = path.relative(srcRoot, abs).split(path.sep).join('/');
      const text = fs.readFileSync(abs, 'utf8');
      for (const pattern of HARD_FORBIDDEN) {
        if (pattern.re.test(text)) {
          violations.push(`${rel} matched ${pattern.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('allows $queryRaw/$executeRaw only on exact allowlisted paths', () => {
    const srcRoot = path.resolve(__dirname, '..');
    const files = walk(srcRoot);
    const violations: string[] = [];

    for (const abs of files) {
      const rel = path.relative(srcRoot, abs).split(path.sep).join('/');
      if (RAW_SQL_ALLOWLIST.has(rel)) {
        continue;
      }
      const text = fs.readFileSync(abs, 'utf8');
      for (const pattern of RAW_SQL_PATTERNS) {
        if (pattern.re.test(text)) {
          violations.push(`${rel} matched ${pattern.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('raw-SQL allowlist entries each exist and have a comment reason', () => {
    for (const [file, reason] of RAW_SQL_ALLOWLIST) {
      expect(reason.trim().length).toBeGreaterThan(5);
      const abs = path.resolve(__dirname, '..', file);
      expect(fs.existsSync(abs)).toBe(true);
    }
  });
});
