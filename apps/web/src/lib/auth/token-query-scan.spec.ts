import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC_ROOT = join(__dirname, '..', '..');

/** Patterns that put an auth action token into a query string (forbidden). */
const FORBIDDEN = [
  /\?[^\n"'`]*\btoken=/i,
  /searchParams\.[^\n]*token/i,
  /URLSearchParams\([^)]*token/i,
  /[`'"][^`'"]*\?[^`'"]*token=/i,
];

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else if (
      /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) &&
      !name.endsWith('.spec.ts') &&
      !name.endsWith('.spec.tsx')
    ) {
      files.push(full);
    }
  }
  return files;
}

describe('action token must not appear in query strings', () => {
  it('scans apps/web/src for token-in-query patterns', () => {
    const files = walk(SRC_ROOT);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Allow documenting fragment form #t= only.
      for (const re of FORBIDDEN) {
        if (re.test(text)) {
          hits.push(`${relative(SRC_ROOT, file)} matched ${re}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
