import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const WEB_ROOT = join(__dirname, '..', '..', '..');
const SRC_ROOT = join(WEB_ROOT, 'src');
const ENV_EXAMPLE = join(WEB_ROOT, '.env.example');
const JEST_ENV = join(WEB_ROOT, 'jest.env.cjs');

const SECRETISH = /(TOKEN|SECRET|PASSWORD|KEY)/i;
const API_URL_REF = /API_URL|API_INTERNAL/i;

function walk(dir: string, files: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

function nextPublicAssignments(source: string): Array<{ name: string; value: string }> {
  const found: Array<{ name: string; value: string }> = [];
  const envLine =
    /^(?:export\s+)?(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/gm;
  let match: RegExpExecArray | null;
  while ((match = envLine.exec(source)) !== null) {
    const name = match[1] ?? '';
    if (!name) {
      continue;
    }
    found.push({ name, value: match[2] ?? match[3] ?? match[4] ?? '' });
  }
  const processEnv = /process\.env\.(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(['"])(.*?)\2/g;
  while ((match = processEnv.exec(source)) !== null) {
    const name = match[1] ?? '';
    if (!name) {
      continue;
    }
    found.push({ name, value: match[3] ?? '' });
  }
  const identOnly = /NEXT_PUBLIC_[A-Z0-9_]+/g;
  while ((match = identOnly.exec(source)) !== null) {
    if (!found.some((f) => f.name === match![0])) {
      found.push({ name: match[0], value: '' });
    }
  }
  return found;
}

function checkAssignment(where: string, name: string, value: string, offenders: string[]): void {
  if (SECRETISH.test(name) || SECRETISH.test(value)) {
    offenders.push(`${where}: ${name} has secret-like TOKEN/SECRET/PASSWORD/KEY`);
  }
  if (API_URL_REF.test(name) || API_URL_REF.test(value)) {
    offenders.push(`${where}: ${name} references API URL`);
  }
}

describe('NEXT_PUBLIC secret scan', () => {
  it('rejects NEXT_PUBLIC_ API URL or secret-like names/values in src, .env.example, jest.env.cjs', () => {
    const offenders: string[] = [];
    const scanFiles = [
      ...walk(SRC_ROOT).filter((f) => {
        if (!/\.(ts|tsx|js|cjs|mjs|env|example)$/.test(f)) {
          return false;
        }
        // This file documents forbidden patterns; skip self.
        return !f.endsWith('next-public-scan.spec.ts');
      }),
      ENV_EXAMPLE,
      JEST_ENV,
    ];

    for (const file of scanFiles) {
      const source = readFileSync(file, 'utf8');
      const rel = relative(WEB_ROOT, file).replace(/\\/g, '/');
      for (const { name, value } of nextPublicAssignments(source)) {
        checkAssignment(rel, name, value, offenders);
      }
    }

    expect(offenders).toEqual([]);
  });
});
