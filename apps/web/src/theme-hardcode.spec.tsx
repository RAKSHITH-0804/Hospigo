import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC_ROOT = __dirname;
const SCAN_ROOTS = [join(SRC_ROOT, 'components'), join(SRC_ROOT, 'app')];

const HEX = /#[0-9a-fA-F]{3,8}\b/;
const RGB = /rgb\s*\(/i;
const FIXED_PX = /(?<![\w-])\d+px\b/;

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

function shouldScan(file: string): boolean {
  if (file.endsWith('globals.css')) {
    return false;
  }
  if (/\.spec\.(tsx|ts|jsx|js)$/.test(file)) {
    return false;
  }
  return /\.(tsx|ts|css)$/.test(file);
}

describe('theme hardcoding guard', () => {
  it('forbids hex colours, rgb(, and fixed px values outside globals.css', () => {
    const offenders: string[] = [];

    for (const root of SCAN_ROOTS) {
      for (const file of walk(root).filter(shouldScan)) {
        const source = readFileSync(file, 'utf8');
        const rel = relative(SRC_ROOT, file).replace(/\\/g, '/');
        if (HEX.test(source)) {
          offenders.push(`${rel}: hex colour`);
        }
        if (RGB.test(source)) {
          offenders.push(`${rel}: rgb(`);
        }
        if (FIXED_PX.test(source)) {
          offenders.push(`${rel}: fixed px value`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
