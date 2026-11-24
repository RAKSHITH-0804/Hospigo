import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const WEB_ROOT = join(__dirname, '..', '..');
const SRC_ROOT = join(WEB_ROOT, 'src');

/** Files that may call Intl.DateTimeFormat directly (helpers, calendar days, zone checks). */
const ALLOW_INTL = new Set([
  'src/lib/format-datetime.ts',
  'src/lib/patients/format.ts',
  'src/lib/opd/reports.ts',
  'src/components/ui/date-picker.tsx',
  'src/config/opd.ts',
]);

const FORBIDDEN_LOCALE = /\.toLocale(?:String|DateString|TimeString)\s*\(/;
const FORBIDDEN_INTL = /new\s+Intl\.DateTimeFormat\s*\(/;

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (
      /\.(ts|tsx)$/.test(name) &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.spec.tsx')
    ) {
      files.push(full);
    }
  }
  return files;
}

describe('date formatting scan', () => {
  it('components and lib use the shared helpers, not the viewer locale', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC_ROOT)) {
      const rel = relative(WEB_ROOT, file).replace(/\\/g, '/');
      const source = readFileSync(file, 'utf8');
      if (FORBIDDEN_LOCALE.test(source)) {
        offenders.push(
          `${rel}: toLocale* (use formatDateTime / formatClock from @/lib/format-datetime)`,
        );
      }
      if (!ALLOW_INTL.has(rel) && FORBIDDEN_INTL.test(source)) {
        offenders.push(
          `${rel}: Intl.DateTimeFormat (use @/lib/format-datetime, or add this file to the allow list with a reason)`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});
