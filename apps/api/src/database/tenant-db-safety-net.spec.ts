import fs from 'node:fs';
import path from 'node:path';

/**
 * SAFETY-NET: scan apps/api/src excluding the database module, seeds, and specs.
 * Feature files must not use PrismaService / $transaction / raw SQL / set_config
 * unless exactly allowlisted (with a reason comment per entry).
 */
const ALLOWLIST = new Map<string, string>([
  // Counter FOR UPDATE on a TenantDb transaction client.
  [
    'modules/patients/uhid.service.ts',
    'UHID counter bump uses $executeRaw/$queryRaw on TenantDb tx',
  ],
  // Name-prefix search on a TenantDb transaction client.
  ['modules/patients/patients.service.ts', 'Name-prefix search uses $queryRaw on TenantDb tx'],
  // Batch row lock on a TenantDb transaction client.
  [
    'modules/imports/import-batch.service.ts',
    'Batch row lock uses $queryRaw FOR UPDATE on TenantDb tx',
  ],
]);

const FORBIDDEN = [
  { name: 'PrismaService', re: /\bPrismaService\b/ },
  { name: '$transaction', re: /\$transaction\s*\(/ },
  { name: '$queryRaw', re: /\$queryRaw/ },
  { name: '$executeRaw', re: /\$executeRaw/ },
  { name: 'set_config', re: /set_config\s*\(/ },
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
  it('fails if feature code uses raw Prisma/$transaction/raw SQL/set_config outside allowlist', () => {
    const srcRoot = path.resolve(__dirname, '..');
    const files = walk(srcRoot);
    const violations: string[] = [];

    for (const abs of files) {
      const rel = path.relative(srcRoot, abs).split(path.sep).join('/');
      if (ALLOWLIST.has(rel)) {
        continue;
      }
      const text = fs.readFileSync(abs, 'utf8');
      for (const pattern of FORBIDDEN) {
        if (pattern.re.test(text)) {
          violations.push(`${rel} matched ${pattern.name}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('allowlist entries each exist and have a comment reason', () => {
    for (const [file, reason] of ALLOWLIST) {
      expect(reason.trim().length).toBeGreaterThan(5);
      const abs = path.resolve(__dirname, '..', file);
      expect(fs.existsSync(abs)).toBe(true);
    }
  });
});
