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
    'modules/patients/uhid.service.ts',
    'UHID counter bump uses $executeRaw/$queryRaw on TenantDb tx',
  ],
  ['modules/patients/patients.service.ts', 'Name-prefix search uses $queryRaw on TenantDb tx'],
  [
    'modules/imports/import-batch.service.ts',
    'Batch row lock uses $queryRaw FOR UPDATE on TenantDb tx',
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
